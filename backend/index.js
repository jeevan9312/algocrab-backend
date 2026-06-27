const { connectWebSocket, subscribeToTokens, getLivePrice, getIsConnected } = require('./marketdata');

const express = require('express');
const dotenv = require('dotenv');
const cron = require('node-cron');
const { loginToAngelOne, getNiftyPrice, placeOrder } = require('./auth');
const { calculateATMStrike, fetchOptionChain, findStrikes, executeStrategy, monitorPnL, exitAllLegs, tradeState, STRATEGY_CONFIG } = require('./strategy');
const axios = require('axios');
dotenv.config();

const app = express();
app.use(express.json());

// ── ROUTES ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'AlgoCrab 945 Straddle Engine Running' });
});

app.get('/status', (req, res) => {
  res.json({
    strategy: STRATEGY_CONFIG.name,
    isActive: tradeState.isActive,
    combinedPnL: tradeState.combinedPnL,
    legs: tradeState.legs.length,
    config: STRATEGY_CONFIG
  });
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
  const expiry = getNextExpiry();

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
  if (!tradeState.isActive) {
    return res.json({ success: false, message: 'No active trade to exit' });
  }
  await exitAllLegs('MANUAL EXIT');
  res.json({ success: true, message: 'All legs exited manually' });
});

app.get('/test/websocket', async (req, res) => {
  try {
    await connectWebSocket();
    
    subscribeToTokens([
      { exchangeType: 1, tokens: ['99926000'] }
    ]);

    await new Promise(resolve => setTimeout(resolve, 3000));

    const niftyPrice = getLivePrice('99926000');
    
    res.json({
      success: true,
      connected: getIsConnected(),
      niftyPrice: niftyPrice
    });

  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/test/scripmaster', async (req, res) => {
  try {
    const expiry = await getNextExpiry();
    console.log('Looking for expiry:', expiry);

    const response = await axios.get(
      'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',
      { timeout: 30000 }
    );

    const niftyOptions = response.data.filter(item =>
      item.name === 'NIFTY' &&
      item.instrumenttype === 'OPTIDX' &&
      item.expiry === expiry
    );

    console.log('Total NIFTY options found:', niftyOptions.length);

    res.json({
      success: true,
      expiry: expiry,
      totalOptions: niftyOptions.length,
      sample: niftyOptions.slice(0, 5)
    });

  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/test/fullchain', async (req, res) => {
  try {
    const expiry = await getNextExpiry();
    
    // Get all NIFTY option tokens for this expiry
    const scripResponse = await axios.get(
      'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',
      { timeout: 30000 }
    );

    const niftyOptions = scripResponse.data.filter(item =>
      item.name === 'NIFTY' &&
      item.instrumenttype === 'OPTIDX' &&
      item.expiry === expiry
    );

    console.log('Total options to subscribe:', niftyOptions.length);

    // Get all tokens
    const tokens = niftyOptions.map(o => o.token);

    // Subscribe via WebSocket
    subscribeToTokens([{ exchangeType: 2, tokens: tokens }]);

    // Wait 5 seconds for prices to come in
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get current Nifty price
    const niftyPrice = await getNiftyPrice();
    const atmStrike = calculateATMStrike(niftyPrice);

    console.log('Nifty price:', niftyPrice);
    console.log('ATM strike:', atmStrike);

    // Build option chain from live websocket data
    const chain = niftyOptions.map(o => {
      const strikeActual = parseFloat(o.strike) / 100;
      const ltp = getLivePrice(o.token);
      const type = o.symbol.endsWith('CE') ? 'CE' : 'PE';
      return {
        strike: strikeActual,
        type: type,
        token: o.token,
        symbol: o.symbol,
        ltp: ltp || 0
      };
    }).filter(o => o.ltp > 0);

    console.log('Options with live prices:', chain.length);

    // Find ATM and ₹10 premium strikes
    const atmCE = chain.find(o => o.strike === atmStrike && o.type === 'CE');
    const atmPE = chain.find(o => o.strike === atmStrike && o.type === 'PE');

    const buyCE = chain
      .filter(o => o.type === 'CE')
      .sort((a, b) => Math.abs(a.ltp - 10) - Math.abs(b.ltp - 10))[0];

    const buyPE = chain
      .filter(o => o.type === 'PE')
      .sort((a, b) => Math.abs(a.ltp - 10) - Math.abs(b.ltp - 10))[0];

    res.json({
      success: true,
      niftyPrice,
      atmStrike,
      optionsWithPrices: chain.length,
      selectedStrikes: {
        sellATMCE: { strike: atmCE?.strike, ltp: atmCE?.ltp, token: atmCE?.token, symbol: atmCE?.symbol },
        sellATMPE: { strike: atmPE?.strike, ltp: atmPE?.ltp, token: atmPE?.token, symbol: atmPE?.symbol },
        buyCE: { strike: buyCE?.strike, ltp: buyCE?.ltp, token: buyCE?.token, symbol: buyCE?.symbol },
        buyPE: { strike: buyPE?.strike, ltp: buyPE?.ltp, token: buyPE?.token, symbol: buyPE?.symbol }
      }
    });

  } catch (error) {
    console.log('Full chain error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// ── SCHEDULER ─────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  console.log(`Scheduler tick: ${currentTime}`);

  if (currentTime === STRATEGY_CONFIG.entryTime && !tradeState.isActive) {
    console.log('9:45 AM reached. Starting 945 Straddle execution...');

    const niftyPrice = await getNiftyPrice();
    if (!niftyPrice) {
      console.log('Failed to get Nifty price. Skipping today.');
      return;
    }

    const atmStrike = calculateATMStrike(niftyPrice);
    const expiry = await getNextExpiry();
    const optionChain = await fetchOptionChain(atmStrike, expiry);

    if (!optionChain) {
      console.log('Failed to fetch option chain. Skipping today.');
      return;
    }

    const strikes = findStrikes(optionChain, atmStrike, STRATEGY_CONFIG.targetPremium);
    if (!strikes.atmCE || !strikes.atmPE || !strikes.buyCE || !strikes.buyPE) {
      console.log('Could not find all required strikes. Skipping today.');
      return;
    }

    await executeStrategy(strikes);
  }

  if (currentTime === STRATEGY_CONFIG.exitTime && tradeState.isActive) {
    console.log('12:00 noon reached. Exiting all legs...');
    await exitAllLegs('TIME EXIT');
  }

  if (tradeState.isActive) {
    await monitorPnL();
  }
});

// ── EXPIRY DETECTION ──────────────────────────────────
async function getNextExpiry() {
  try {
    const response = await axios.get(
      'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',
      { timeout: 30000 }
    );

    // Get all NIFTY option expiries
    const expiries = [...new Set(
      response.data
        .filter(i => i.name === 'NIFTY' && i.instrumenttype === 'OPTIDX')
        .map(i => i.expiry)
    )];

    // Sort by date and find nearest upcoming expiry
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };

    const sortedExpiries = expiries
      .map(e => {
        const day = parseInt(e.substring(0, 2));
        const month = months[e.substring(2, 5)];
        const year = parseInt(e.substring(5));
        return { expiry: e, date: new Date(year, month, day) };
      })
      .filter(e => e.date >= today)
      .sort((a, b) => a.date - b.date);

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
  const result = await loginToAngelOne();
  if (result) {
    console.log('Engine ready. Waiting for 9:45 AM on expiry day...');
  } else {
    console.log('Login failed. Please check credentials.');
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startup();
});