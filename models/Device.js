const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: { 
    type: String, 
    unique: true, 
    required: true 
  },
  name: { 
    type: String, 
    default: function() { return this.deviceId; }
  },
  type: { 
    type: String, 
    enum: ['irrigation', 'sensor', 'controller', 'other'], 
    default: 'irrigation' 
  },
  owner: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    default: null
  },
  sharedWith: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'pending', 'maintenance'], 
    default: 'pending' 
  },
  permissions: {
    allowControl: { type: Boolean, default: false },
    allowDataView: { type: Boolean, default: true },
    allowDelete: { type: Boolean, default: false }
  },
  metadata: {
    firmware: String,
    macAddress: String,
    chipId: String,
    location: String
  },
  lastSeen: Date,
  registeredAt: { type: Date, default: Date.now }
});

// Virtual field để check online/offline
DeviceSchema.virtual('isOnline').get(function() {
  if (!this.lastSeen) return false;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.lastSeen > fiveMinutesAgo;
});

DeviceSchema.set('toJSON', { virtuals: true });
DeviceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Device', DeviceSchema);
