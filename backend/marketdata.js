const WebSocket = require('ws');
const { getTokens } = require('./auth');
const dotenv = require('dotenv');
dotenv.config();

let ws = null;
let marketData = {};
let isConnected = false;
let lastSubscribedTokens = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

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
      reconnectAttempts = 0;

      // Re-subscribe to whatever we were subscribed to before (if reconnecting)
      if (lastSubscribedTokens.length > 0) {
        console.log('Re-subscribing to', lastSubscribedTokens.length, 'previous subscriptions...');
        doSubscribe(lastSubscribedTokens);
      }

      // Start heartbeat ping every 25 seconds to keep connection alive
      startHeartbeat();

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
    });

    ws.on('close', () => {
      console.log('WebSocket disconnected');
      isConnected = false;
      stopHeartbeat();
      attemptReconnect();
    });
  });
}

// ── HEARTBEAT TO KEEP CONNECTION ALIVE ────────────────
let heartbeatInterval = null;
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws && isConnected) {
      try {
        ws.send('ping');
      } catch (e) {
        console.log('Heartbeat ping failed:', e.message);
      }
    }
  }, 25000);
}
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ── AUTO RECONNECT ─────────────────────────────────────
function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('Max reconnect attempts reached. Giving up.');
    return;
  }
  reconnectAttempts++;
  const delay = Math.min(30000 * reconnectAttempts, 120000);
  console.log(`Reconnecting WebSocket in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
  setTimeout(() => {
    connectWebSocket().catch(err => {
      console.log('Reconnect failed:', err);
    });
  }, delay);
}

function parseBinaryData(buffer) {
  try {
    if (buffer.length < 47) return;

    const token = buffer.slice(2, 27).toString('utf8').replace(/\0/g, '').trim();
    const ltp = buffer.readInt32LE(43) / 100;

    if (token && ltp > 0) {
      marketData[token] = ltp;
    }
  } catch (error) {
    // Skip parse errors silently to avoid log spam
  }
}

function doSubscribe(tokenList) {
  if (!ws || !isConnected) {
    console.log('WebSocket not connected, cannot subscribe yet');
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

function subscribeToTokens(tokenList) {
  lastSubscribedTokens = tokenList;
  doSubscribe(tokenList);
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