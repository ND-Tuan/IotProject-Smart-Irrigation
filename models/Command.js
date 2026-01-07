const mongoose = require('mongoose');

const CommandSchema = new mongoose.Schema({
  deviceId: { 
    type: String, 
    required: true,
    index: true
  },
  command: { 
    type: String, 
    required: true,
    enum: ['PUMP_ON', 'PUMP_OFF', 'SET_MODE', 'SET_THRESHOLD', 'SCHEDULE', 'REBOOT']
  },
  params: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: { 
    type: String, 
    enum: ['pending', 'sent', 'completed', 'failed', 'timeout'], 
    default: 'pending' 
  },
  issuedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  createdAt: { type: Date, default: Date.now },
  sentAt: Date,
  completedAt: Date,
  error: String
});

// Index để query nhanh
CommandSchema.index({ deviceId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Command', CommandSchema);
