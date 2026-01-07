const mongoose = require('mongoose');

const MeasurementSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  temp: { type: Number, default: null },
  hum: { type: Number, default: null },
  soil: { type: Number, default: null },
  timestamp: { type: Date, default: Date.now }
});

// Compound index cho query hiệu quả
MeasurementSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('Measurement', MeasurementSchema);
