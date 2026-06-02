const express = require('express');
const dotenv = require('dotenv');
const { loginToAngelOne, placeOrder } = require('./auth');

dotenv.config();

const app = express();
app.use(express.json());

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});