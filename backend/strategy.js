const { placeOrder, getTokens } = require('./auth');
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
  lotSize: 75,
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

// ── STEP 3: FETCH OPTION CHAIN FROM NSE ───────────────
async function fetchOptionChain(atmStrike, expiry) {
  try {
    console.log('Fetching option chain from NSE...');

    const axiosInstance = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }
    });

    // Step 1 - Visit NSE homepage to get session cookies
    console.log('Getting NSE session...');
    const homeResponse = await axiosInstance.get('https://www.nseindia.com');
    
    const rawCookies = homeResponse.headers['set-cookie'] || [];
    const cookieString = rawCookies.map(c => c.split(';')[0]).join('; ');
    console.log('Session cookies obtained:', rawCookies.length, 'cookies');

    // Step 2 - Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 3 - Fetch option chain
    console.log('Fetching option chain data...');
    const response = await axiosInstance.get(
      'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY',
      {
        headers: {
          'Referer': 'https://www.nseindia.com/option-chain',
          'Cookie': cookieString,
          'X-Requested-With': 'XMLHttpRequest',
          'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin'
        }
      }
    );

    console.log('NSE response status:', response.status);
    console.log('Response type:', typeof response.data);

    if (response.data && response.data.records && response.data.records.data && response.data.records.data.length > 0) {
      console.log('Option chain received. Total records:', response.data.records.data.length);

      const availableExpiries = [...new Set(response.data.records.data.map(i => i.expiryDate))];
      console.log('Available expiries:', availableExpiries);

      const expiryDate = formatExpiryForNSE(expiry);
      console.log('Looking for expiry:', expiryDate);

      let filtered = response.data.records.data.filter(item => item.expiryDate === expiryDate);

      if (filtered.length === 0) {
        console.log('Expiry not found. Using nearest available.');
        filtered = response.data.records.data.filter(item => item.expiryDate === availableExpiries[0]);
      }

      console.log('Strikes found:', filtered.length);
      return convertToOurFormat(filtered);
    }

    console.log('Empty response. Data:', JSON.stringify(response.data).substring(0, 200));
    return null;

  } catch (error) {
    console.log('NSE fetch error:', error.message);
    console.log('Status:', error.response?.status);
    console.log('Response:', JSON.stringify(error.response?.data)?.substring(0, 200));
    return null;
  }
}

// ── HELPER: CONVERT NSE FORMAT ────────────────────────
function convertToOurFormat(data) {
  const options = [];
  for (const item of data) {
    if (item.CE) {
      options.push({
        strikePrice: item.strikePrice,
        optionType: 'CE',
        ltp: item.CE.lastPrice,
        tradingSymbol: `NIFTY${item.strikePrice}CE`,
        symbolToken: ''
      });
    }
    if (item.PE) {
      options.push({
        strikePrice: item.strikePrice,
        optionType: 'PE',
        ltp: item.PE.lastPrice,
        tradingSymbol: `NIFTY${item.strikePrice}PE`,
        symbolToken: ''
      });
    }
  }
  console.log('Total options converted:', options.length);
  return options;
}

// ── HELPER: FORMAT EXPIRY FOR NSE ─────────────────────
function formatExpiryForNSE(expiry) {
  // Convert 02JUL26 to 02-Jul-2026
  const day = expiry.substring(0, 2);
  const monthStr = expiry.substring(2, 5);
  const year = '20' + expiry.substring(5, 7);

  const months = {
    'JAN': 'Jan', 'FEB': 'Feb', 'MAR': 'Mar', 'APR': 'Apr',
    'MAY': 'May', 'JUN': 'Jun', 'JUL': 'Jul', 'AUG': 'Aug',
    'SEP': 'Sep', 'OCT': 'Oct', 'NOV': 'Nov', 'DEC': 'Dec'
  };

  return `${day}-${months[monthStr]}-${year}`;
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

// ── STEP 5: EXECUTE ALL 4 LEGS ────────────────────────
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

// ── STEP 6: MONITOR COMBINED PNL ──────────────────────
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
          'X-ClientPublicIP': '202.141.41.21',
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

// ── STEP 7: EXIT ALL LEGS ─────────────────────────────
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