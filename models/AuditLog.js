const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    index: true
  },
  deviceId: { 
    type: String,
    index: true
  },
  action: { 
    type: String, 
    required: true 
  },
  details: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String,
  success: { type: Boolean, default: true },
  timestamp: { type: Date, default: Date.now }
});

// TTL index - tự động xóa logs sau 90 ngày
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

module.exports = mongoose.model('AuditLog', AuditLogSchema);
