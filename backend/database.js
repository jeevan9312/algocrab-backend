const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config();

// ── USER SCHEMA ───────────────────────────────────────
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  angelOneClientId: { type: String, default: null },
  angelOnePassword: { type: String, default: null },
  angelOneTotpSecret: { type: String, default: null },
  isAngelOneConnected: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

// ── CONNECT TO MONGODB ────────────────────────────────
async function connectDB() {
  try {
    console.log('Connecting to MongoDB...');
    console.log('URI:', process.env.MONGODB_URI?.substring(0, 30) + '****');

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
    });

    console.log('MongoDB connected!');
  } catch (error) {
    console.log('MongoDB connection error:', error.message);
  }
}

module.exports = { connectDB, User };