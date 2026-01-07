const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { authMiddleware, checkRole } = require('../middleware/auth');

// Số lượng devices online
router.get('/devices-online', authMiddleware, async (req, res) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const [total, online, offline, pending] = await Promise.all([
      Device.countDocuments({ status: { $ne: 'pending' } }),
      Device.countDocuments({ 
        status: 'active',
        lastSeen: { $gte: fiveMinutesAgo } 
      }),
      Device.countDocuments({ 
        status: 'active',
        lastSeen: { $lt: fiveMinutesAgo } 
      }),
      Device.countDocuments({ status: 'pending' })
    ]);
    
    res.json({
      success: true,
      data: {
        total,
        online,
        offline,
        pending
      }
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy thống kê devices' });
  }
});

// Logs (chỉ admin)
router.get('/logs', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const { userId, deviceId, action, limit = 100, page = 1 } = req.query;
    
    const query = {};
    if (userId) query.userId = userId;
    if (deviceId) query.deviceId = deviceId;
    if (action) query.action = new RegExp(action, 'i');
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('userId', 'username email')
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .skip(skip),
      AuditLog.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy logs' });
  }
});

// Thống kê tổng quan (chỉ admin)
router.get('/stats', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const [
      totalUsers,
      totalDevices,
      activeDevices,
      pendingDevices,
      totalLogs
    ] = await Promise.all([
      User.countDocuments(),
      Device.countDocuments(),
      Device.countDocuments({ status: 'active' }),
      Device.countDocuments({ status: 'pending' }),
      AuditLog.countDocuments()
    ]);
    
    // Devices online
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineDevices = await Device.countDocuments({
      status: 'active',
      lastSeen: { $gte: fiveMinutesAgo }
    });
    
    res.json({
      success: true,
      data: {
        users: totalUsers,
        devices: {
          total: totalDevices,
          active: activeDevices,
          online: onlineDevices,
          pending: pendingDevices
        },
        auditLogs: totalLogs
      }
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy thống kê' });
  }
});

module.exports = router;
