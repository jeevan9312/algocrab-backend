const { getLivePrice, subscribeToTokens } = require('./marketdata');
const { getNiftyPrice } = require('./auth');
const axios = require('axios');

// ── PAPER TRADE STATE ─────────────────────────────────
let paperTradeState = {
  isActive: false,
  mode: 'PAPER', // PAPER or LIVE
  entryTime: null,
  exitTime: null,
  legs: [],
  combinedPnL: 0,
  exitReason: null,
  history: []
};

// ── EXECUTE PAPER STRATEGY ────────────────────────────
async function executePaperStrategy(strikes) {
  const { atmCE, atmPE, buyCE, buyPE } = strikes;

  console.log('PAPER TRADE: Recording entry for all 4 legs...');

  const legs = [
    {
      name: 'BUY CE',
      type: 'BUY',
      symbol: buyCE.tradingSymbol,
      token: buyCE.symbolToken,
      strike: buyCE.strikePrice,
      entryPrice: buyCE.ltp,
      currentPrice: buyCE.ltp
    },
    {
      name: 'BUY PE',
      type: 'BUY',
      symbol: buyPE.tradingSymbol,
      token: buyPE.symbolToken,
      strike: buyPE.strikePrice,
      entryPrice: buyPE.ltp,
      currentPrice: buyPE.ltp
    },
    {
      name: 'SELL ATM CE',
      type: 'SELL',
      symbol: atmCE.tradingSymbol,
      token: atmCE.symbolToken,
      strike: atmCE.strikePrice,
      entryPrice: atmCE.ltp,
      currentPrice: atmCE.ltp
    },
    {
      name: 'SELL ATM PE',
      type: 'SELL',
      symbol: atmPE.tradingSymbol,
      token: atmPE.symbolToken,
      strike: atmPE.strikePrice,
      entryPrice: atmPE.ltp,
      currentPrice: atmPE.ltp
    }
  ];

  paperTradeState.isActive = true;
  paperTradeState.entryTime = new Date().toLocaleTimeString();
  paperTradeState.legs = legs;
  paperTradeState.combinedPnL = 0;
  paperTradeState.exitReason = null;

  console.log('PAPER TRADE: All 4 legs recorded.');
  legs.forEach(leg => {
    console.log(`  ${leg.name}: ${leg.symbol} @ ₹${leg.entryPrice}`);
  });

  // Subscribe to live prices for all 4 legs
  const tokens = legs.map(l => l.token);
  subscribeToTokens([{ exchangeType: 2, tokens }]);

  return legs;
}

// ── MONITOR PAPER TRADE PNL ───────────────────────────
function monitorPaperPnL(lotSize, lots, profitTarget, stopLoss) {
  if (!paperTradeState.isActive) return;

  const quantity = lotSize * lots;
  let totalPnL = 0;

  for (const leg of paperTradeState.legs) {
    const livePrice = getLivePrice(leg.token);
    if (livePrice) {
      leg.currentPrice = livePrice;
    }

    // BUY leg profits when price goes up. SELL leg profits when price goes down.
    let legPnL;
    if (leg.type === 'BUY') {
      legPnL = (leg.currentPrice - leg.entryPrice) * quantity;
    } else {
      legPnL = (leg.entryPrice - leg.currentPrice) * quantity;
    }

    leg.pnl = legPnL;
    totalPnL += legPnL;
  }

  paperTradeState.combinedPnL = totalPnL;
  console.log(`PAPER TRADE PnL: ₹${totalPnL.toFixed(2)}`);

  if (totalPnL >= profitTarget) {
    exitPaperTrade('PROFIT TARGET');
  } else if (totalPnL <= -stopLoss) {
    exitPaperTrade('STOP LOSS');
  }

  return totalPnL;
}

// ── EXIT PAPER TRADE ───────────────────────────────────
function exitPaperTrade(reason) {
  if (!paperTradeState.isActive) return;

  console.log(`PAPER TRADE: Exiting all legs. Reason: ${reason}`);

  paperTradeState.exitTime = new Date().toLocaleTimeString();
  paperTradeState.exitReason = reason;

  // Save to history
  paperTradeState.history.unshift({
    date: new Date().toLocaleDateString(),
    entryTime: paperTradeState.entryTime,
    exitTime: paperTradeState.exitTime,
    exitReason: reason,
    finalPnL: paperTradeState.combinedPnL,
    legs: [...paperTradeState.legs]
  });

  paperTradeState.isActive = false;
  console.log(`PAPER TRADE CLOSED. Final PnL: ₹${paperTradeState.combinedPnL.toFixed(2)}`);
}

// ── MANUAL RESET ───────────────────────────────────────
function resetPaperTrade() {
  paperTradeState.isActive = false;
  paperTradeState.entryTime = null;
  paperTradeState.exitTime = null;
  paperTradeState.legs = [];
  paperTradeState.combinedPnL = 0;
  paperTradeState.exitReason = null;
  console.log('Paper trade state reset.');
}

module.exports = {
  paperTradeState,
  executePaperStrategy,
  monitorPaperPnL,
  exitPaperTrade,
  resetPaperTrade
};