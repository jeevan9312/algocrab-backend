const { placeOrder, getTokens } = require('./auth');
const { subscribeToTokens, getLivePrice } = require('./marketdata');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const STRATEGY_CONFIG = {
  name: '945 Straddle',
  entryTime: '09:45',
  exitTime: '12:00',
  profitTarget: 1000,
  stopLoss: 1000,
  targetPremium: 10,
  lotSize: 65,
  lots: 1,
  instrument: 'NIFTY',
  exchange: 'NFO'
};

let tradeState = {
  isActive: false,
  legs: [],
  combinedPnL: 0
};

// ── STEP 2: CALCULATE ATM STRIKE ──────────────────────
function calculateATMStrike(niftyPrice) {
  const atm = Math.round(niftyPrice / 50) * 50;
  console.log(`Nifty: ${niftyPrice} → ATM Strike: ${atm}`);
  return atm;
}

// ── STEP 3: FETCH OPTION CHAIN VIA ANGEL ONE WEBSOCKET ─
// This is the proven working method - uses Angel One scrip master
// for token list and WebSocket for live prices. No NSE scraping needed.
async function fetchOptionChain(atmStrike, expiry) {
  try {
    console.log('Fetching option chain via Angel One scrip master + WebSocket...');

    // Step 1 - Get all NIFTY option tokens for this expiry from scrip master
    const scripResponse = await axios.get(
      'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',
      { timeout: 30000 }
    );

    const niftyOptions = scripResponse.data.filter(item =>
      item.name === 'NIFTY' &&
      item.instrumenttype === 'OPTIDX' &&
      item.expiry === expiry
    );

    console.log('Total NIFTY options found for expiry', expiry, ':', niftyOptions.length);

    if (niftyOptions.length === 0) {
      console.log('No options found for this expiry');
      return null;
    }

    // Step 2 - Subscribe to all these tokens via WebSocket
    const tokens = niftyOptions.map(o => o.token);
    subscribeToTokens([{ exchangeType: 2, tokens: tokens }]);

    // Step 3 - Wait for live prices to come in
    console.log('Waiting for live prices from WebSocket...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 4 - Build option chain from live websocket data
    const chain = niftyOptions.map(o => {
      const strikeActual = parseFloat(o.strike) / 100;
      const ltp = getLivePrice(o.token);
      const type = o.symbol.endsWith('CE') ? 'CE' : 'PE';
      return {
        strikePrice: strikeActual,
        optionType: type,
        ltp: ltp || 0,
        tradingSymbol: o.symbol,
        symbolToken: o.token
      };
    }).filter(o => o.ltp > 0);

    console.log('Options with live prices:', chain.length, 'out of', niftyOptions.length);

    if (chain.length === 0) {
      console.log('No live prices received. Market may be closed or WebSocket not subscribed in time.');
      return null;
    }

    return chain;

  } catch (error) {
    console.log('Error fetching option chain:', error.message);
    return null;
  }
}

// ── STEP 4: FIND RIGHT STRIKES ────────────────────────
function findStrikes(optionChain, atmStrike, targetPremium) {
  let atmCE = null;
  let atmPE = null;
  let buyCE = null;
  let buyPE = null;
  let minCEDiff = Infinity;
  let minPEDiff = Infinity;

  for (const option of optionChain) {
    const strike = parseFloat(option.strikePrice);
    const ltp = parseFloat(option.ltp);

    // Find ATM strikes for selling
    if (strike === atmStrike) {
      if (option.optionType === 'CE') atmCE = option;
      if (option.optionType === 'PE') atmPE = option;
    }

    // Find closest to target premium for buying
    if (option.optionType === 'CE') {
      const diff = Math.abs(ltp - targetPremium);
      if (diff < minCEDiff) {
        minCEDiff = diff;
        buyCE = option;
      }
    }

    if (option.optionType === 'PE') {
      const diff = Math.abs(ltp - targetPremium);
      if (diff < minPEDiff) {
        minPEDiff = diff;
        buyPE = option;
      }
    }
  }

  console.log('ATM CE:', atmCE?.strikePrice, '@ ₹', atmCE?.ltp);
  console.log('ATM PE:', atmPE?.strikePrice, '@ ₹', atmPE?.ltp);
  console.log('Buy CE:', buyCE?.strikePrice, '@ ₹', buyCE?.ltp);
  console.log('Buy PE:', buyPE?.strikePrice, '@ ₹', buyPE?.ltp);

  return { atmCE, atmPE, buyCE, buyPE };
}

// ── STEP 5: EXECUTE ALL 4 LEGS (LIVE MODE) ────────────
async function executeStrategy(strikes) {
  const { atmCE, atmPE, buyCE, buyPE } = strikes;
  const quantity = STRATEGY_CONFIG.lotSize * STRATEGY_CONFIG.lots;

  console.log('Placing all 4 legs...');

  const legs = [
    { symbol: buyCE.tradingSymbol, token: buyCE.symbolToken, type: 'BUY', name: 'BUY CE' },
    { symbol: buyPE.tradingSymbol, token: buyPE.symbolToken, type: 'BUY', name: 'BUY PE' },
    { symbol: atmCE.tradingSymbol, token: atmCE.symbolToken, type: 'SELL', name: 'SELL ATM CE' },
    { symbol: atmPE.tradingSymbol, token: atmPE.symbolToken, type: 'SELL', name: 'SELL ATM PE' }
  ];

  const results = [];
  for (const leg of legs) {
    const result = await placeOrder(leg.symbol, leg.token, quantity, leg.type);
    console.log(`${leg.name}:`, result?.status === true ? 'SUCCESS' : 'FAILED');
    results.push({ ...leg, result });
  }

  tradeState.isActive = true;
  tradeState.legs = results;
  console.log('All legs placed. Monitoring started.');
  return results;
}

// ── STEP 6: MONITOR COMBINED PNL (LIVE MODE) ──────────
async function monitorPnL() {
  if (!tradeState.isActive) return;

  try {
    const tokens = getTokens();
    if (!tokens) return;

    const response = await axios.get(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
      {
        headers: {
          'Authorization': `Bearer ${tokens.jwtToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '103.103.209.155',
          'X-MACAddress': '00:00:00:00:00:00',
          'X-PrivateKey': process.env.ANGEL_ONE_API_KEY
        }
      }
    );

    if (!response.data || response.data.status !== true) return;

    let totalPnL = 0;
    for (const position of response.data.data) {
      totalPnL += parseFloat(position.unrealised || 0);
    }

    tradeState.combinedPnL = totalPnL;
    console.log(`Combined PnL: ₹${totalPnL.toFixed(2)}`);

    if (totalPnL >= STRATEGY_CONFIG.profitTarget) {
      console.log('PROFIT TARGET HIT. Exiting all legs...');
      await exitAllLegs('PROFIT TARGET');
    } else if (totalPnL <= -STRATEGY_CONFIG.stopLoss) {
      console.log('STOP LOSS HIT. Exiting all legs...');
      await exitAllLegs('STOP LOSS');
    }

  } catch (error) {
    console.log('PnL monitor error:', error.message);
  }
}

// ── STEP 7: EXIT ALL LEGS (LIVE MODE) ─────────────────
async function exitAllLegs(reason) {
  if (!tradeState.isActive) return;

  console.log(`Exiting all legs. Reason: ${reason}`);
  const quantity = STRATEGY_CONFIG.lotSize * STRATEGY_CONFIG.lots;

  for (const leg of tradeState.legs) {
    const exitType = leg.type === 'BUY' ? 'SELL' : 'BUY';
    const result = await placeOrder(leg.symbol, leg.token, quantity, exitType);
    console.log(`Exit ${leg.name}:`, result?.status === true ? 'SUCCESS' : 'FAILED');
  }

  tradeState.isActive = false;
  tradeState.legs = [];
  tradeState.combinedPnL = 0;
  console.log(`All legs exited. Reason: ${reason}`);
}

module.exports = {
  STRATEGY_CONFIG,
  tradeState,
  calculateATMStrike,
  fetchOptionChain,
  findStrikes,
  executeStrategy,
  monitorPnL,
  exitAllLegs
};