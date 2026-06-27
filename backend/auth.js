const { SmartAPI } = require('smartapi-javascript');
const speakeasy = require('speakeasy');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

let smartApi = null;
let tokens = null;

async function loginToAngelOne() {
  let attempts = 0;
  while (attempts < 3) {
    try {
      attempts++;
      console.log(`Login attempt ${attempts}...`);

      const totp = speakeasy.totp({
        secret: process.env.ANGEL_ONE_TOTP_SECRET,
        encoding: 'base32'
      });

      console.log('Generated TOTP:', totp);

      smartApi = new SmartAPI({
        api_key: process.env.ANGEL_ONE_API_KEY
      });

      const data = await smartApi.generateSession(
        process.env.ANGEL_ONE_CLIENT_ID,
        process.env.ANGEL_ONE_PASSWORD,
        totp
      );

      console.log('Login response:', JSON.stringify(data, null, 2));

      if (data && data.status === true) {
        tokens = data.data;
        console.log('Login successful!');
        return tokens;
      } else {
        console.log('Login failed:', data?.message);
        if (attempts < 3) {
          console.log('Retrying in 5 seconds...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

    } catch (error) {
      console.log('Login error:', error.message);
      if (attempts < 3) {
        console.log('Retrying in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  console.log('All login attempts failed.');
  return null;
}

async function getNiftyPrice() {
  try {
    if (!tokens) {
      await loginToAngelOne();
      if (!tokens) return null;
    }

    const response = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getLtpData',
      {
        exchange: 'NSE',
        tradingsymbol: 'Nifty 50',
        symboltoken: '99926000'
      },
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

    if (response.data && response.data.status === true) {
      console.log('Nifty LTP:', response.data.data.ltp);
      return response.data.data.ltp;
    }
    console.log('LTP response:', JSON.stringify(response.data));
    return null;
  } catch (error) {
    console.log('Error fetching Nifty price:', error.response?.data || error.message);
    return null;
  }
}

async function placeOrder(symbol, token, quantity, transactionType) {
  try {
    if (!tokens) {
      await loginToAngelOne();
      if (!tokens) return null;
    }

    const response = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/placeOrder',
      {
        variety: 'NORMAL',
        tradingsymbol: symbol,
        symboltoken: token,
        transactiontype: transactionType,
        exchange: 'NFO',
        ordertype: 'MARKET',
        producttype: 'CARRYFORWARD',
        duration: 'DAY',
        quantity: quantity.toString()
      },
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

    console.log('Order response:', JSON.stringify(response.data, null, 2));
    return response.data;

  } catch (error) {
    console.log('Order error:', error.response?.data || error.message);
    return null;
  }
}

module.exports = { loginToAngelOne, getNiftyPrice, placeOrder, getTokens: () => tokens };