const mongoose = require('mongoose');

const ScheduleSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  time: { type: String, required: true }, // Format: "HH:MM"
  days: { type: [Number], required: true }, // [0-6] 0=CN, 1=T2, ..., 6=T7
  duration: { type: Number, default: 60 }, // Thời gian tưới (phút)
  enabled: { type: Number, default: 1 }, // 1=enabled, 0=disabled
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

// Compound index
ScheduleSchema.index({ deviceId: 1, enabled: 1 });

module.exports = mongoose.model('Schedule', ScheduleSchema);
