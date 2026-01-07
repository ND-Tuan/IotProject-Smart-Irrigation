const Device = require('../models/Device');
const AuditLog = require('../models/AuditLog');

// Kiểm tra user có quyền truy cập device không
async function checkDeviceAccess(req, res, next) {
  try {
    const deviceId = req.params.deviceId || req.body.deviceId || req.query.deviceId;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Thiếu deviceId' });
    }
    
    const device = await Device.findOne({ deviceId });
    
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    const userId = req.user._id.toString();
    
    // Admin có quyền truy cập tất cả
    if (req.user.role === 'admin') {
      req.device = device;
      return next();
    }
    
    // Owner có quyền truy cập
    if (device.owner && device.owner.toString() === userId) {
      req.device = device;
      return next();
    }
    
    // User được share có quyền truy cập
    if (device.sharedWith.some(id => id.toString() === userId)) {
      req.device = device;
      return next();
    }
    
    // Log unauthorized access
    await AuditLog.create({
      userId: req.user._id,
      deviceId,
      action: `UNAUTHORIZED_DEVICE_ACCESS: ${req.method} ${req.path}`,
      ipAddress: req.ip,
      success: false
    });
    
    return res.status(403).json({ error: 'Không có quyền truy cập device này' });
    
  } catch (err) {
    console.error('Device access check error:', err);
    return res.status(500).json({ error: 'Lỗi kiểm tra quyền truy cập' });
  }
}

// Kiểm tra quyền điều khiển
function checkControlPermission(req, res, next) {
  if (!req.device) {
    return res.status(400).json({ error: 'Device chưa được xác thực' });
  }
  
  if (!req.device.permissions.allowControl) {
    return res.status(403).json({ 
      error: 'Device không cho phép điều khiển',
      deviceId: req.device.deviceId 
    });
  }
  
  if (req.device.status !== 'active') {
    return res.status(403).json({ 
      error: 'Device không ở trạng thái active',
      status: req.device.status 
    });
  }
  
  next();
}

// Kiểm tra quyền xem dữ liệu
function checkViewPermission(req, res, next) {
  if (!req.device) {
    return res.status(400).json({ error: 'Device chưa được xác thực' });
  }
  
  if (!req.device.permissions.allowDataView) {
    return res.status(403).json({ 
      error: 'Device không cho phép xem dữ liệu',
      deviceId: req.device.deviceId 
    });
  }
  
  next();
}

module.exports = { 
  checkDeviceAccess, 
  checkControlPermission, 
  checkViewPermission 
};
