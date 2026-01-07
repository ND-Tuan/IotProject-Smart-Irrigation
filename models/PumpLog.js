const mongoose = require('mongoose');

const PumpLogSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  action: { type: String, required: true }, // 'ON' hoặc 'OFF'
  mode: { type: String, required: true }, // 'AUTO' hoặc 'MANUAL'
  timestamp: { type: Date, default: Date.now }
});

// Compound index cho query hiệu quả
PumpLogSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('PumpLog', PumpLogSchema);
