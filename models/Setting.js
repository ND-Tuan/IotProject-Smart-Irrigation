const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
  deviceId: { type: String, default: null }, // null = global settings
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

// Unique compound index: 1 setting per (deviceId, key)
SettingSchema.index({ deviceId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Setting', SettingSchema);
