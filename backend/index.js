const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

const { connectDB } = require('./database');
const { registerUser, loginUser, verifyToken, saveAngelOneCredentials, getUserCredentials, resetStrategy } = require('./auth_users');
const { connectWebSocket, subscribeToTokens, getLivePrice, getIsConnected } = require('./marketdata');
const { loginToAngelOne, getNiftyPrice, placeOrder } = require('./auth');
const { calculateATMStrike, fetchOptionChain, findStrikes, executeStrategy, monitorPnL, exitAllLegs, tradeState, STRATEGY_CONFIG } = require('./strategy');
const { paperTradeState, executePaperStrategy, monitorPaperPnL, exitPaperTrade, resetPaperTrade } = require('./papertrading');

const app = express();
app.use(express.json());


// ── TRADING MODE ──────────────────────────────────────
let TRADING_MODE = 'PAPER';

// ── ROUTES ────────────────────────────────────────────
app.get('/myip2', async (req, res) => {
  try {
    const response = await axios.get('https://ifconfig.me/ip');
    res.json({ ip: response.data.trim() });
  } catch (error) {
    res.json({ error: error.message });
  }
});

app.get('/myip', async (req, res) => {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    res.json(response.data);
  } catch (error) {
    res.json({ error: error.message });
  }
});


app.get('/', (req, res) => {
  res.json({ message: 'AlgoCrab 945 Straddle Engine Running' });
});

app.get('/status', (req, res) => {
  const activeState = TRADING_MODE === 'PAPER' ? paperTradeState : tradeState;
  res.json({
    strategy: STRATEGY_CONFIG.name,
    mode: TRADING_MODE,
    isActive: activeState.isActive,
    combinedPnL: activeState.combinedPnL,
    legs: activeState.legs,
    entryTime: activeState.entryTime || null,
    exitTime: activeState.exitTime || null,
    exitReason: activeState.exitReason || null,
    config: STRATEGY_CONFIG
  });
});

app.get('/mode', (req, res) => {
  res.json({ mode: TRADING_MODE });
});

app.post('/mode', (req, res) => {
  const { mode } = req.body;
  if (mode !== 'PAPER' && mode !== 'LIVE') {
    return res.json({ success: false, message: 'Mode must be PAPER or LIVE' });
  }
  TRADING_MODE = mode;
  console.log('Trading mode switched to: ' + TRADING_MODE);
  res.json({ success: true, mode: TRADING_MODE });
});

app.get('/history', (req, res) => {
  res.json({ success: true, history: paperTradeState.history });
});

app.get('/test/nifty', async (req, res) => {
  const price = await getNiftyPrice();
  if (price) {
    const atm = calculateATMStrike(price);
    res.json({ success: true, niftyPrice: price, atmStrike: atm });
  } else {
    res.json({ success: false, message: 'Could not fetch Nifty price' });
  }
});

app.get('/test/optionchain', async (req, res) => {
  const price = await getNiftyPrice();
  if (!price) return res.json({ success: false, message: 'Could not fetch Nifty price' });

  const atm = calculateATMStrike(price);
  const expiry = await getNextExpiry();

  console.log('Testing option chain fetch for expiry:', expiry);
  const chain = await fetchOptionChain(atm, expiry);

  if (chain) {
    const strikes = findStrikes(chain, atm, STRATEGY_CONFIG.targetPremium);
    res.json({
      success: true,
      niftyPrice: price,
      atmStrike: atm,
      expiry: expiry,
      totalStrikes: chain.length,
      selectedStrikes: {
        buyingCE: { strike: strikes.buyCE?.strikePrice, premium: strikes.buyCE?.ltp },
        buyingPE: { strike: strikes.buyPE?.strikePrice, premium: strikes.buyPE?.ltp },
        sellingATMCE: { strike: strikes.atmCE?.strikePrice, premium: strikes.atmCE?.ltp },
        sellingATMPE: { strike: strikes.atmPE?.strikePrice, premium: strikes.atmPE?.ltp }
      }
    });
  } else {
    res.json({ success: false, message: 'Could not fetch option chain' });
  }
});

app.post('/exit', async (req, res) => {
  if (TRADING_MODE === 'PAPER') {
    if (!paperTradeState.isActive) {
      return res.json({ success: false, message: 'No active paper trade to exit' });
    }
    exitPaperTrade('MANUAL EXIT');
    return res.json({ success: true, message: 'Paper trade exited manually' });
  }

  if (!tradeState.isActive) {
    return res.json({ success: false, message: 'No active trade to exit' });
  }
  await exitAllLegs('MANUAL EXIT');
  res.json({ success: true, message: 'All legs exited manually' });
});

app.post('/reset-trade', (req, res) => {
  resetPaperTrade();
  res.json({ success: true, message: 'Paper trade reset' });
});

// ── DEMO: TRIGGER STRATEGY RIGHT NOW (PAPER MODE ONLY) ─
app.post('/demo/trigger', async (req, res) => {
  try {
    if (paperTradeState.isActive) {
      return res.json({ success: false, message: 'A paper trade is already active. Exit it first.' });
    }

    console.log('DEMO: Manually triggering strategy execution now...');

    const niftyPrice = await getNiftyPrice();
    if (!niftyPrice) {
      return res.json({ success: false, message: 'Could not fetch Nifty price. Is market open?' });
    }

    const atmStrike = calculateATMStrike(niftyPrice);
    const expiry = await getNextExpiry();
    const optionChain = await fetchOptionChain(atmStrike, expiry);

    if (!optionChain) {
      return res.json({ success: false, message: 'Could not fetch option chain. Is market open?' });
    }

    const strikes = findStrikes(optionChain, atmStrike, STRATEGY_CONFIG.targetPremium);
    if (!strikes.atmCE || !strikes.atmPE || !strikes.buyCE || !strikes.buyPE) {
      return res.json({ success: false, message: 'Could not find all required strikes' });
    }

    const legs = await executePaperStrategy(strikes);

    res.json({
      success: true,
      message: 'Demo paper trade started',
      niftyPrice,
      atmStrike,
      legs
    });

  } catch (error) {
    console.log('Demo trigger error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// ── USER AUTH ROUTES ──────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.json({ success: false, message: 'All fields are required' });
  }
  const result = await registerUser(name, email, password);
  res.json(result);
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, message: 'Email and password required' });
  }
  const result = await loginUser(email, password);
  res.json(result);
});

app.post('/auth/verify', (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ success: false, message: 'No token provided' });
  const result = verifyToken(token);
  res.json(result);
});

app.post('/auth/reset', async (req, res) => {
  const { token } = req.body;
  const verify = verifyToken(token);
  if (!verify.success) return res.json({ success: false, message: 'Unauthorized' });
  const result = await resetStrategy(verify.user.userId);
  res.json(result);
});

app.post('/auth/connect-angelone', async (req, res) => {
  const { token, clientId, password, totpSecret } = req.body;

  const verify = verifyToken(token);
  if (!verify.success) return res.json({ success: false, message: 'Unauthorized' });

  const speakeasy = require('speakeasy');
  const { SmartAPI } = require('smartapi-javascript');

  try {
    const totp = speakeasy.totp({ secret: totpSecret, encoding: 'base32' });
    const testApi = new SmartAPI({ api_key: process.env.ANGEL_ONE_API_KEY });
    const data = await testApi.generateSession(clientId, password, totp);

    if (data && data.status === true) {
      const result = await saveAngelOneCredentials(verify.user.userId, clientId, password, totpSecret);
      res.json(result);
    } else {
      res.json({ success: false, message: 'Invalid Angel One credentials' });
    }
  } catch (error) {
    res.json({ success: false, message: 'Could not verify Angel One credentials' });
  }
});

app.get('/auth/angelone-status', async (req, res) => {
  const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null;
  if (!token) return res.json({ success: false, message: 'No token' });

  const verify = verifyToken(token);
  if (!verify.success) return res.json({ success: false, message: 'Unauthorized' });

  const result = await getUserCredentials(verify.user.userId);
  res.json({ success: true, isConnected: result.success });
});

// ── SCHEDULER ─────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

  const isActive = TRADING_MODE === 'PAPER' ? paperTradeState.isActive : tradeState.isActive;
  console.log('Scheduler tick: ' + currentTime + ' | Mode: ' + TRADING_MODE);

  if (currentTime === STRATEGY_CONFIG.entryTime && !isActive) {
    console.log('9:45 AM reached. Starting 945 Straddle execution (' + TRADING_MODE + ' mode)...');

    const niftyPrice = await getNiftyPrice();
    if (!niftyPrice) { console.log('Failed to get Nifty price. Skipping.'); return; }

    const atmStrike = calculateATMStrike(niftyPrice);
    const expiry = await getNextExpiry();
    const optionChain = await fetchOptionChain(atmStrike, expiry);

    if (!optionChain) { console.log('Failed to fetch option chain. Skipping.'); return; }

    const strikes = findStrikes(optionChain, atmStrike, STRATEGY_CONFIG.targetPremium);
    if (!strikes.atmCE || !strikes.atmPE || !strikes.buyCE || !strikes.buyPE) {
      console.log('Could not find all required strikes. Skipping.'); return;
    }

    if (TRADING_MODE === 'PAPER') {
      await executePaperStrategy(strikes);
    } else {
      await executeStrategy(strikes);
    }
  }

  if (currentTime === STRATEGY_CONFIG.exitTime && isActive) {
    console.log('12:00 noon reached. Exiting all legs...');
    if (TRADING_MODE === 'PAPER') {
      exitPaperTrade('TIME EXIT');
    } else {
      await exitAllLegs('TIME EXIT');
    }
  }

  if (isActive) {
    if (TRADING_MODE === 'PAPER') {
      monitorPaperPnL(
        STRATEGY_CONFIG.lotSize,
        STRATEGY_CONFIG.lots,
        STRATEGY_CONFIG.profitTarget,
        STRATEGY_CONFIG.stopLoss
      );
    } else {
      await monitorPnL();
    }
  }
});

setInterval(function() {
  if (TRADING_MODE === 'PAPER' && paperTradeState.isActive) {
    monitorPaperPnL(
      STRATEGY_CONFIG.lotSize,
      STRATEGY_CONFIG.lots,
      STRATEGY_CONFIG.profitTarget,
      STRATEGY_CONFIG.stopLoss
    );
  }
}, 10000);

// ── EXPIRY DETECTION ──────────────────────────────────
async function getNextExpiry() {
  try {
    const response = await axios.get(
      'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',
      { timeout: 30000 }
    );

    const expiries = [...new Set(
      response.data
        .filter(function(i) { return i.name === 'NIFTY' && i.instrumenttype === 'OPTIDX'; })
        .map(function(i) { return i.expiry; })
    )];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };

    const sortedExpiries = expiries
      .map(function(e) {
        const day = parseInt(e.substring(0, 2));
        const month = months[e.substring(2, 5)];
        const year = parseInt(e.substring(5));
        return { expiry: e, date: new Date(year, month, day) };
      })
      .filter(function(e) { return e.date >= today; })
      .sort(function(a, b) { return a.date - b.date; });

    const nearest = sortedExpiries[0].expiry;
    console.log('Nearest expiry from scrip master:', nearest);
    return nearest;
  } catch (error) {
    console.log('Error getting expiry:', error.message);
    return null;
  }
}

// ── STARTUP ───────────────────────────────────────────
async function startup() {
  console.log('Starting AlgoCrab 945 Straddle Engine...');
  console.log('Trading Mode: ' + TRADING_MODE);

  await connectDB();

  const result = await loginToAngelOne();
  if (result) {
    await connectWebSocket();
    console.log('Engine ready. Waiting for 9:45 AM on expiry day...');
  } else {
    console.log('Login failed. Please check credentials.');
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
  startup();
});