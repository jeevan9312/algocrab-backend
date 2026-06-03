const express = require('express');
const dotenv = require('dotenv');
const cron = require('node-cron');
const { loginToAngelOne, placeOrder } = require('./auth');

dotenv.config();

const app = express();
app.use(express.json());

// Trade configuration
let tradeConfig = {
  symbol: 'SBIN-EQ',
  token: '3045',
  quantity: 1,
  buyTime: '10:15',
  profitTarget: 500,
  stopLoss: 300,
  exitTime: '15:15',
  isActive: false
};

let currentTrade = {
  inTrade: false,
  entryPrice: null,
  orderId: null
};

app.get('/', (req, res) => {
  res.json({ message: 'AlgoCrab backend is running!' });
});

app.get('/login', async (req, res) => {
  const result = await loginToAngelOne();
  if (result) {
    res.json({ success: true, message: 'Logged in successfully' });
  } else {
    res.json({ success: false, message: 'Login failed' });
  }
});

app.post('/config', (req, res) => {
  const { symbol, token, quantity, buyTime, profitTarget, stopLoss, exitTime } = req.body;
  tradeConfig = { ...tradeConfig, ...req.body, isActive: true };
  console.log('Trade config updated:', tradeConfig);
  res.json({ success: true, message: 'Config saved', config: tradeConfig });
});

app.get('/config', (req, res) => {
  res.json(tradeConfig);
});

app.get('/status', (req, res) => {
  res.json({ tradeConfig, currentTrade });
});

app.post('/buy', async (req, res) => {
  const { symbol, token, quantity } = req.body;
  const result = await placeOrder(symbol, token, quantity, 'BUY');
  if (result) {
    res.json({ success: true, data: result });
  } else {
    res.json({ success: false, message: 'Order failed' });
  }
});

app.post('/sell', async (req, res) => {
  const { symbol, token, quantity } = req.body;
  const result = await placeOrder(symbol, token, quantity, 'SELL');
  if (result) {
    res.json({ success: true, data: result });
  } else {
    res.json({ success: false, message: 'Order failed' });
  }
});

// ── TIME BASED SCHEDULER ──────────────────────────────
cron.schedule('* * * * *', async () => {
  if (!tradeConfig.isActive) return;

  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  console.log(`Scheduler running at ${currentTime}`);

  // Buy time check
  if (currentTime === tradeConfig.buyTime && !currentTrade.inTrade) {
    console.log('Buy time reached! Placing buy order...');
    const result = await placeOrder(
      tradeConfig.symbol,
      tradeConfig.token,
      tradeConfig.quantity,
      'BUY'
    );
    if (result && result.success !== false) {
      currentTrade.inTrade = true;
      currentTrade.orderId = result.data;
      console.log('Buy order placed successfully!');
    }
  }

  // Exit time check
  if (currentTime === tradeConfig.exitTime && currentTrade.inTrade) {
    console.log('Exit time reached! Placing sell order...');
    const result = await placeOrder(
      tradeConfig.symbol,
      tradeConfig.token,
      tradeConfig.quantity,
      'SELL'
    );
    if (result) {
      currentTrade.inTrade = false;
      currentTrade.entryPrice = null;
      console.log('Sell order placed at exit time!');
    }
  }
});

console.log('Scheduler started. Watching for trade times...');

// ── LOGIN ON STARTUP ──────────────────────────────────
loginToAngelOne().then(() => {
  console.log('Auto login successful on startup');
}).catch(err => {
  console.log('Auto login failed:', err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});