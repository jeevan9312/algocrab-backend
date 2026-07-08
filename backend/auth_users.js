const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('./database');
const dotenv = require('dotenv');
dotenv.config();

// ── REGISTER ──────────────────────────────────────────
async function registerUser(name, email, password) {
  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return { success: false, message: 'Email already registered' };
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({ name, email, password: hashedPassword });
    await user.save();

    console.log('New user registered:', email);
    return { success: true, message: 'Account created successfully' };

  } catch (error) {
    console.log('Register error:', error.message);
    return { success: false, message: 'Registration failed' };
  }
}

// ── LOGIN ─────────────────────────────────────────────
async function loginUser(email, password) {
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return { success: false, message: 'Email not found' };
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return { success: false, message: 'Incorrect password' };
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('User logged in:', email);
    return {
      success: true,
      token,
      user: {
        name: user.name,
        email: user.email,
        isAngelOneConnected: user.isAngelOneConnected
      }
    };

  } catch (error) {
    console.log('Login error:', error.message);
    return { success: false, message: 'Login failed' };
  }
}

// ── VERIFY TOKEN ──────────────────────────────────────
function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { success: true, user: decoded };
  } catch (error) {
    return { success: false, message: 'Invalid or expired token' };
  }
}

// ── SAVE ANGEL ONE CREDENTIALS ────────────────────────
async function saveAngelOneCredentials(userId, clientId, password, totpSecret) {
  try {
    await User.findByIdAndUpdate(userId, {
      angelOneClientId: clientId,
      angelOnePassword: password,
      angelOneTotpSecret: totpSecret,
      isAngelOneConnected: true
    });

    console.log('Angel One credentials saved for user:', userId);
    return { success: true, message: 'Angel One account connected successfully' };

  } catch (error) {
    console.log('Save credentials error:', error.message);
    return { success: false, message: 'Failed to save credentials' };
  }
}

// ── GET USER ANGEL ONE CREDENTIALS ───────────────────
async function getUserCredentials(userId) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.isAngelOneConnected) {
      return { success: false, message: 'Angel One not connected' };
    }

    return {
      success: true,
      credentials: {
        clientId: user.angelOneClientId,
        password: user.angelOnePassword,
        totpSecret: user.angelOneTotpSecret
      }
    };

  } catch (error) {
    console.log('Get credentials error:', error.message);
    return { success: false, message: 'Failed to get credentials' };
  }
}

// ── RESET STRATEGY ────────────────────────────────────
async function resetStrategy(userId) {
  try {
    console.log('Strategy reset for user:', userId);
    return { success: true, message: 'Strategy settings reset successfully' };
  } catch (error) {
    return { success: false, message: 'Reset failed' };
  }
}

module.exports = {
  registerUser,
  loginUser,
  verifyToken,
  saveAngelOneCredentials,
  getUserCredentials,
  resetStrategy
};