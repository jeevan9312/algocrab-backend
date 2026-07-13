const BACKEND_URL = 'https://algocrab-backend-production.up.railway.app'; 

// ── SCREEN MANAGEMENT ─────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showMessage(id, text, isSuccess = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = isSuccess ? 'message success' : 'message error';
}

// ── GET STORED TOKEN ──────────────────────────────────
function getToken() {
  return localStorage.getItem('algocrab_token');
}

function getUser() {
  const u = localStorage.getItem('algocrab_user');
  return u ? JSON.parse(u) : null;
}

// ── INIT ──────────────────────────────────────────────
async function init() {
  const token = getToken();
  if (token) {
    const user = getUser();
    if (user) {
      document.getElementById('userName').textContent = `Hi, ${user.name}`;
      showScreen('screen-dashboard');
      loadDashboard();
    } else {
      showScreen('screen-login');
    }
  } else {
    showScreen('screen-login');
  }
}

// ── LOGIN ─────────────────────────────────────────────
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!email || !password) {
    showMessage('loginMessage', 'Please fill in all fields');
    return;
  }

  showMessage('loginMessage', 'Logging in...', true);

  try {
    const response = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();

    if (data.success) {
      localStorage.setItem('algocrab_token', data.token);
      localStorage.setItem('algocrab_user', JSON.stringify(data.user));
      document.getElementById('userName').textContent = `Hi, ${data.user.name}`;

      if (data.user.isAngelOneConnected) {
        showScreen('screen-dashboard');
        loadDashboard();
      } else {
        showScreen('screen-connect-angelone');
      }
    } else {
      showMessage('loginMessage', data.message);
    }
  } catch (error) {
    showMessage('loginMessage', 'Cannot connect to server');
  }
});

// ── REGISTER ──────────────────────────────────────────
document.getElementById('registerBtn').addEventListener('click', async () => {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  if (!name || !email || !password) {
    showMessage('registerMessage', 'Please fill in all fields');
    return;
  }

  showMessage('registerMessage', 'Creating account...', true);

  try {
    const response = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await response.json();

    if (data.success) {
      showMessage('registerMessage', 'Account created! Please login.', true);
      setTimeout(() => showScreen('screen-login'), 1500);
    } else {
      showMessage('registerMessage', data.message);
    }
  } catch (error) {
    showMessage('registerMessage', 'Cannot connect to server');
  }
});

// ── CONNECT ANGEL ONE ─────────────────────────────────
document.getElementById('connectAngelBtn').addEventListener('click', async () => {
  const clientId = document.getElementById('angelClientId').value.trim();
  const password = document.getElementById('angelPassword').value.trim();
  const totpSecret = document.getElementById('angelTotpSecret').value.trim();

  if (!clientId || !password || !totpSecret) {
    showMessage('connectAngelMessage', 'Please fill in all fields');
    return;
  }

  showMessage('connectAngelMessage', 'Verifying credentials...', true);

  const token = getToken();

  try {
    const response = await fetch(`${BACKEND_URL}/auth/connect-angelone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, clientId, password, totpSecret })
    });
    const data = await response.json();

    if (data.success) {
      showMessage('connectAngelMessage', 'Angel One connected successfully!', true);
      setTimeout(() => {
        showScreen('screen-dashboard');
        loadDashboard();
      }, 1500);
    } else {
      showMessage('connectAngelMessage', data.message);
    }
  } catch (error) {
    showMessage('connectAngelMessage', 'Cannot connect to server');
  }
});

document.getElementById('skipAngelConnect').addEventListener('click', () => {
  showScreen('screen-dashboard');
  loadDashboard();
});

// ── LOGOUT ────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('algocrab_token');
  localStorage.removeItem('algocrab_user');
  showScreen('screen-login');
});

// ── RESET ─────────────────────────────────────────────
document.getElementById('resetBtn').addEventListener('click', async () => {
  try {
    const response = await fetch(`${BACKEND_URL}/reset-trade`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      alert('Paper trade reset successfully');
      loadDashboard();
    }
  } catch (error) {
    console.log('Reset error:', error.message);
  }
});

// ── DEMO TRIGGER ──────────────────────────────────────
document.getElementById('demoBtn').addEventListener('click', async () => {
  const btn = document.getElementById('demoBtn');
  btn.disabled = true;
  btn.textContent = 'Starting demo trade...';

  try {
    const response = await fetch(`${BACKEND_URL}/demo/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await response.json();

    if (data.success) {
      loadDashboard();
    } else {
      alert(data.message);
    }
  } catch (error) {
    alert('Cannot connect to server. Is it running?');
  }

  btn.disabled = false;
  btn.textContent = '▶ Trigger Demo Trade Now';
});

// ── NAVIGATION ────────────────────────────────────────
document.getElementById('goToRegister').addEventListener('click', () => showScreen('screen-register'));
document.getElementById('goToLogin').addEventListener('click', () => showScreen('screen-login'));
document.getElementById('refreshBtn').addEventListener('click', () => loadDashboard());

// ── LOAD DASHBOARD ────────────────────────────────────
async function loadDashboard() {
  const content = document.getElementById('dashContent');
  content.innerHTML = '<div class="loading">Loading live data...</div>';

  try {
    const [statusRes, niftyRes] = await Promise.all([
      fetch(`${BACKEND_URL}/status`),
      fetch(`${BACKEND_URL}/test/nifty`)
    ]);

    const status = await statusRes.json();
    const niftyData = await niftyRes.json();

    const pnl = status.combinedPnL || 0;
    const pnlColor = pnl > 0 ? 'green' : pnl < 0 ? 'red' : 'white';

    let legsHtml = '';
    if (status.isActive && status.legs && status.legs.length > 0) {
      legsHtml = `
        <div class="section-title">Active Legs (${status.mode} mode)</div>
        <table class="legs-table">
          <tr><th>Type</th><th>Symbol</th><th>Entry</th><th>Current</th><th>P&L</th></tr>
          ${status.legs.map(leg => `
            <tr>
              <td><span class="badge ${leg.type === 'BUY' ? 'buy' : 'sell'}">${leg.type}</span></td>
              <td>${leg.symbol ? leg.symbol.replace('NIFTY', '').replace(/\d{2}[A-Z]{3}\d{4}/, '') : leg.name}</td>
              <td>₹${leg.entryPrice ? leg.entryPrice.toFixed(2) : '--'}</td>
              <td>₹${leg.currentPrice ? leg.currentPrice.toFixed(2) : '--'}</td>
              <td style="color:${leg.pnl > 0 ? '#4caf50' : leg.pnl < 0 ? '#f44336' : '#888'}">₹${leg.pnl ? leg.pnl.toFixed(2) : '0.00'}</td>
            </tr>
          `).join('')}
        </table>
      `;
    }

    content.innerHTML = `
      <div class="status-row">
        <div class="dot ${status.isActive ? 'green' : 'yellow'}"></div>
        <div class="status-text">
          Strategy: <span>${status.isActive ? 'In Trade (' + status.mode + ')' : 'Waiting for 9:45 AM'}</span>
        </div>
      </div>

      <div class="status-row">
        <div class="dot green"></div>
        <div class="status-text">
          Angel One: <span>Connected</span> &nbsp;|&nbsp; WebSocket: <span>Live</span>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-label">Nifty Price</div>
          <div class="card-value">₹${niftyData.niftyPrice || '--'}</div>
        </div>
        <div class="card">
          <div class="card-label">ATM Strike</div>
          <div class="card-value white">${niftyData.atmStrike || '--'}</div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-label">Mode</div>
          <div class="card-value small white">${status.mode}</div>
        </div>
        <div class="card">
          <div class="card-label">Combined P&L</div>
          <div class="card-value ${pnlColor}">₹${pnl.toFixed(2)}</div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-label">Profit Target</div>
          <div class="card-value green small">₹${status.config?.profitTarget || '--'}</div>
        </div>
        <div class="card">
          <div class="card-label">Stop Loss</div>
          <div class="card-value red small">₹${status.config?.stopLoss || '--'}</div>
        </div>
      </div>

      ${legsHtml}

      <div style="text-align:center;margin-top:12px;font-size:10px;color:#333">
        Last updated: ${new Date().toLocaleTimeString()}
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="loading" style="color:#f44336">Cannot connect to server.<br>Make sure node index.js is running.</div>`;
  }
}

// Auto refresh every 10 seconds
setInterval(loadDashboard, 10000);

// Start
init();