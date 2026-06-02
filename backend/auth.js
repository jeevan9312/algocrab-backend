const { SmartAPI } = require('smartapi-javascript');
const speakeasy = require('speakeasy');
const dotenv = require('dotenv');

dotenv.config();

let smartApi = null;
let tokens = null;

async function loginToAngelOne() {
  try {
    const totp = speakeasy.totp({
      secret: process.env.ANGEL_ONE_TOTP_SECRET,
      encoding: 'base32'
    });

    smartApi = new SmartAPI({
      api_key: process.env.ANGEL_ONE_API_KEY
    });

    const data = await smartApi.generateSession(
      process.env.ANGEL_ONE_CLIENT_ID,
      process.env.ANGEL_ONE_PASSWORD,
      totp
    );

    if (data.status === true) {
      tokens = data.data;
      console.log('Login successful!');
      return tokens;
    } else {
      console.log('Login failed:', data.message);
      return null;
    }

  } catch (error) {
    console.log('Error:', error.message);
    return null;
  }
}

async function placeOrder(symbol, token, quantity, transactionType) {
  try {
    if (!smartApi || !tokens) {
      console.log('Not logged in. Logging in first...');
      await loginToAngelOne();
    }

    const orderData = {
      variety: 'NORMAL',
      tradingsymbol: symbol,
      symboltoken: token,
      transactiontype: transactionType,
      exchange: 'NSE',
      ordertype: 'MARKET',
      producttype: 'INTRADAY',
      duration: 'DAY',
      quantity: quantity.toString()
    };

    console.log('Placing order:', orderData);

    const response = await smartApi.placeOrder(orderData);
    console.log('Order response:', JSON.stringify(response, null, 2));
    return response;

  } catch (error) {
    console.log('Order error:', error.message);
    return null;
  }
}

module.exports = { loginToAngelOne, placeOrder };