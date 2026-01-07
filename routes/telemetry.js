const express = require('express');
const router = express.Router();
const Measurement = require('../models/Measurement');
const Device = require('../models/Device');
const { authMiddleware } = require('../middleware/auth');
const { checkDeviceAccess, checkViewPermission } = require('../middleware/deviceAccess');

// API mở (không cần auth) để devices gửi dữ liệu
// Trong thực tế nên dùng device token, nhưng để đơn giản thì mở
router.post('/', async (req, res) => {
  try {
    const { deviceId, temp, hum, soil } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Thiếu deviceId' });
    }
    
    // Tự động đăng ký device nếu chưa có
    let device = await Device.findOne({ deviceId });
    if (!device) {
      device = await Device.create({
        deviceId,
        type: 'irrigation',
        status: 'pending',
        permissions: {
          allowControl: false,
          allowDataView: true
        }
      });
      console.log('🆕 Device mới tự động đăng ký:', deviceId);
    }
    
    // Cập nhật lastSeen
    device.lastSeen = new Date();
    await device.save();
    
    // Lưu dữ liệu
    const measurement = await Measurement.create({
      deviceId,
      temp,
      hum,
      soil
    });
    
    res.json({
      success: true,
      message: 'Dữ liệu đã được lưu',
      data: measurement
    });
    
  } catch (err) {
    console.error('Telemetry error:', err);
    res.status(500).json({ error: 'Lỗi lưu dữ liệu: ' + err.message });
  }
});

// Lấy dữ liệu telemetry (cần auth)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { deviceId, startTime, endTime, limit = 100, page = 1 } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Thiếu deviceId' });
    }
    
    // Kiểm tra quyền truy cập device
    const device = await Device.findOne({ deviceId });
    
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    // Kiểm tra permission
    if (req.user.role !== 'admin') {
      const userId = req.user._id.toString();
      const hasAccess = device.owner?.toString() === userId || 
                       device.sharedWith.some(id => id.toString() === userId);
      
      if (!hasAccess) {
        return res.status(403).json({ error: 'Không có quyền xem dữ liệu device này' });
      }
    }
    
    if (!device.permissions.allowDataView) {
      return res.status(403).json({ error: 'Device không cho phép xem dữ liệu' });
    }
    
    // Build query
    const query = { deviceId };
    
    if (startTime || endTime) {
      query.timestamp = {};
      if (startTime) query.timestamp.$gte = new Date(startTime);
      if (endTime) query.timestamp.$lte = new Date(endTime);
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [data, total] = await Promise.all([
      Measurement.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .skip(skip),
      Measurement.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
    
  } catch (err) {
    console.error('Get telemetry error:', err);
    res.status(500).json({ error: 'Lỗi lấy dữ liệu' });
  }
});

// Lấy dữ liệu mới nhất
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Thiếu deviceId' });
    }
    
    // Kiểm tra quyền
    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    if (req.user.role !== 'admin') {
      const userId = req.user._id.toString();
      const hasAccess = device.owner?.toString() === userId || 
                       device.sharedWith.some(id => id.toString() === userId);
      
      if (!hasAccess) {
        return res.status(403).json({ error: 'Không có quyền xem dữ liệu device này' });
      }
    }
    
    const latest = await Measurement.findOne({ deviceId })
      .sort({ timestamp: -1 });
    
    res.json({
      success: true,
      data: latest
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy dữ liệu mới nhất' });
  }
});

module.exports = router;
