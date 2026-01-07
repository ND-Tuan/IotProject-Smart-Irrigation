const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { checkDeviceAccess } = require('../middleware/deviceAccess');
const AuditLog = require('../models/AuditLog');

// Lấy danh sách devices của user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    console.log('📱 GET /api/devices - User:', req.user.username, 'Role:', req.user.role);
    
    let query = {};
    if (req.user.role === 'admin') {
      // Admin xem tất cả
      query = {};
    } else {
      // User chỉ xem devices của mình + được share
      query = {
        $or: [
          { owner: userId },
          { sharedWith: userId }
        ]
      };
    }
    
    const devices = await Device.find(query)
      .populate('owner', 'username email')
      .populate('sharedWith', 'username email')
      .sort({ registeredAt: -1 });
    
    console.log(`   Tìm thấy ${devices.length} devices:`, devices.map(d => `${d.deviceId} (${d.status})`));
    
    res.json({
      success: true,
      count: devices.length,
      data: devices
    });
    
  } catch (err) {
    console.error('Get devices error:', err);
    res.status(500).json({ error: 'Lỗi lấy danh sách devices' });
  }
});

// Lấy chi tiết 1 device
router.get('/:deviceId', authMiddleware, checkDeviceAccess, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .populate('owner', 'username email')
      .populate('sharedWith', 'username email');
    
    res.json({
      success: true,
      data: device
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy thông tin device' });
  }
});

// Cập nhật thông tin device
router.put('/:deviceId', authMiddleware, checkDeviceAccess, async (req, res) => {
  try {
    const { name, metadata } = req.body;
    
    // Chỉ owner hoặc admin mới được update
    if (req.device.owner && 
        req.device.owner.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Chỉ owner hoặc admin mới có quyền cập nhật' });
    }
    
    const updateData = {};
    if (name) updateData.name = name;
    if (metadata) updateData.metadata = { ...req.device.metadata, ...metadata };
    
    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      updateData,
      { new: true }
    );
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId: req.params.deviceId,
      action: 'DEVICE_UPDATED',
      details: updateData,
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Cập nhật device thành công',
      data: device
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật device' });
  }
});

// Approve device mới (chỉ Admin)
router.post('/:deviceId/approve', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const { ownerId, allowControl } = req.body;
    
    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      {
        owner: ownerId || null,
        status: 'active',
        'permissions.allowControl': allowControl !== false,
        'permissions.allowDataView': true
      },
      { new: true }
    );
    
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId: req.params.deviceId,
      action: 'DEVICE_APPROVED',
      details: { ownerId, allowControl },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Device đã được approve',
      data: device
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi approve device' });
  }
});

// Thay đổi trạng thái device
router.patch('/:deviceId/status', authMiddleware, checkDeviceAccess, checkRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['active', 'inactive', 'maintenance'].includes(status)) {
      return res.status(400).json({ error: 'Status không hợp lệ' });
    }
    
    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { status },
      { new: true }
    );
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId: req.params.deviceId,
      action: 'DEVICE_STATUS_CHANGED',
      details: { status },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Cập nhật trạng thái thành công',
      data: device
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật trạng thái' });
  }
});

// Share device với user khác
router.post('/:deviceId/share', authMiddleware, checkDeviceAccess, async (req, res) => {
  try {
    const { userIds } = req.body; // Array of user IDs
    
    // Chỉ owner hoặc admin mới share được
    if (req.device.owner && 
        req.device.owner.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Chỉ owner hoặc admin mới có quyền share' });
    }
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds phải là array không rỗng' });
    }
    
    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { $addToSet: { sharedWith: { $each: userIds } } },
      { new: true }
    ).populate('sharedWith', 'username email');
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId: req.params.deviceId,
      action: 'DEVICE_SHARED',
      details: { sharedWith: userIds },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Share device thành công',
      data: device
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi share device' });
  }
});

// Xóa device (chỉ Admin)
router.delete('/:deviceId', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const device = await Device.findOneAndDelete({ deviceId: req.params.deviceId });
    
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId: req.params.deviceId,
      action: 'DEVICE_DELETED',
      details: { deviceName: device.name },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Xóa device thành công'
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xóa device' });
  }
});

// Share device với user cụ thể (Admin hoặc Owner)
router.post('/:deviceId/share', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    // Kiểm tra quyền: phải là admin hoặc owner
    if (req.user.role !== 'admin' && 
        (!device.owner || device.owner.toString() !== req.user._id.toString())) {
      return res.status(403).json({ error: 'Chỉ admin hoặc owner mới có quyền share device' });
    }
    
    // Thêm user vào sharedWith nếu chưa có
    if (!device.sharedWith.includes(userId)) {
      device.sharedWith.push(userId);
      await device.save();
      
      await AuditLog.create({
        userId: req.user._id,
        deviceId: req.params.deviceId,
        action: 'DEVICE_SHARED_WITH_USER',
        details: { sharedWithUserId: userId },
        ipAddress: req.ip
      });
    }
    
    res.json({
      success: true,
      message: 'Share device thành công',
      data: device
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi share device: ' + err.message });
  }
});

// Xóa quyền truy cập của user (Admin hoặc Owner)
router.delete('/:deviceId/share/:userId', authMiddleware, async (req, res) => {
  try {
    const { deviceId, userId } = req.params;
    const device = await Device.findOne({ deviceId });
    
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    // Kiểm tra quyền: phải là admin hoặc owner
    if (req.user.role !== 'admin' && 
        (!device.owner || device.owner.toString() !== req.user._id.toString())) {
      return res.status(403).json({ error: 'Chỉ admin hoặc owner mới có quyền xóa quyền truy cập' });
    }
    
    // Xóa user khỏi sharedWith
    device.sharedWith = device.sharedWith.filter(id => id.toString() !== userId);
    await device.save();
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId,
      action: 'DEVICE_UNSHARED_WITH_USER',
      details: { unsharedUserId: userId },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Đã xóa quyền truy cập'
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xóa quyền: ' + err.message });
  }
});

// Cập nhật permissions cho device (Admin hoặc Owner)
router.put('/:deviceId/permissions', authMiddleware, async (req, res) => {
  try {
    const { allowControl, allowDataView, allowDelete } = req.body;
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    
    if (!device) {
      return res.status(404).json({ error: 'Device không tồn tại' });
    }
    
    // Kiểm tra quyền: phải là admin hoặc owner
    if (req.user.role !== 'admin' && 
        (!device.owner || device.owner.toString() !== req.user._id.toString())) {
      return res.status(403).json({ error: 'Chỉ admin hoặc owner mới có quyền cập nhật permissions' });
    }
    
    // Cập nhật permissions
    if (typeof allowControl === 'boolean') device.permissions.allowControl = allowControl;
    if (typeof allowDataView === 'boolean') device.permissions.allowDataView = allowDataView;
    if (typeof allowDelete === 'boolean') device.permissions.allowDelete = allowDelete;
    
    await device.save();
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId: req.params.deviceId,
      action: 'DEVICE_PERMISSIONS_UPDATED',
      details: { permissions: device.permissions },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Cập nhật permissions thành công',
      data: device
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật permissions: ' + err.message });
  }
});

module.exports = router;
