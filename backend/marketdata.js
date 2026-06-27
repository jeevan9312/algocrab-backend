const WebSocket = require('ws');
const { getTokens } = require('./auth');
const dotenv = require('dotenv');
dotenv.config();

let ws = null;
let marketData = {};
let isConnected = false;

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const tokens = getTokens();
    if (!tokens) {
      console.log('No tokens available for WebSocket');
      reject('No tokens');
      return;
    }

    const feedToken = tokens.feedToken;
    const clientId = process.env.ANGEL_ONE_CLIENT_ID;

    console.log('Connecting to Angel One WebSocket...');

    ws = new WebSocket(`wss://smartapisocket.angelone.in/smart-stream`, {
      headers: {
        'Authorization': feedToken,
        'x-client-code': clientId,
        'x-feed-token': feedToken,
        'x-client-res': '0'
      }
    });

    ws.on('open', () => {
      console.log('WebSocket connected!');
      isConnected = true;
      resolve(ws);
    });

    ws.on('message', (data) => {
      try {
        if (Buffer.isBuffer(data)) {
          parseBinaryData(data);
        } else {
          const msg = JSON.parse(data.toString());
          console.log('WS message:', JSON.stringify(msg));
        }
      } catch (error) {
        console.log('WS message error:', error.message);
      }
    });

    ws.on('error', (error) => {
      console.log('WebSocket error:', error.message);
      isConnected = false;
      reject(error);
    });

    ws.on('close', () => {
      console.log('WebSocket disconnected');
      isConnected = false;
    });
  });
}

function parseBinaryData(buffer) {
  try {
    if (buffer.length < 47) return;

    const token = buffer.slice(2, 27).toString('utf8').replace(/\0/g, '').trim();
    const ltp = buffer.readInt32LE(43) / 100;

    if (token && ltp > 0) {
      marketData[token] = ltp;
      console.log(`Token: ${token} | LTP: ₹${ltp}`);
    }
  } catch (error) {
    console.log('Parse error:', error.message);
  }
}

function subscribeToTokens(tokenList) {
  if (!ws || !isConnected) {
    console.log('WebSocket not connected');
    return;
  }

  const subscribeMsg = {
    correlationID: 'algocrab001',
    action: 1,
    params: {
      mode: 1,
      tokenList: tokenList
    }
  };

  ws.send(JSON.stringify(subscribeMsg));
  console.log('Subscribed to tokens:', tokenList.length, 'instruments');
}

function getLivePrice(token) {
  return marketData[token] || null;
}

function getIsConnected() {
  return isConnected;
}

module.exports = {
  connectWebSocket,
  subscribeToTokens,
  getLivePrice,
  getIsConnected,
  marketData
};