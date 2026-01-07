const express = require('express');
const router = express.Router();
const Command = require('../models/Command');
const Device = require('../models/Device');
const { authMiddleware } = require('../middleware/auth');
const { checkDeviceAccess, checkControlPermission } = require('../middleware/deviceAccess');
const AuditLog = require('../models/AuditLog');

// Lấy danh sách lệnh
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { deviceId, status, limit = 50 } = req.query;
    
    let query = {};
    
    // Nếu không phải admin, chỉ xem lệnh của devices mình có quyền
    if (req.user.role !== 'admin') {
      const devices = await Device.find({
        $or: [
          { owner: req.user._id },
          { sharedWith: req.user._id }
        ]
      }).select('deviceId');
      
      const deviceIds = devices.map(d => d.deviceId);
      query.deviceId = { $in: deviceIds };
    }
    
    if (deviceId) query.deviceId = deviceId;
    if (status) query.status = status;
    
    const commands = await Command.find(query)
      .populate('issuedBy', 'username email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      count: commands.length,
      data: commands
    });
    
  } catch (err) {
    console.error('Get commands error:', err);
    res.status(500).json({ error: 'Lỗi lấy danh sách lệnh' });
  }
});

// Tạo lệnh mới (gửi command xuống device)
router.post('/', authMiddleware, checkDeviceAccess, checkControlPermission, async (req, res) => {
  try {
    const { deviceId, command, params } = req.body;
    
    if (!deviceId || !command) {
      return res.status(400).json({ error: 'Thiếu deviceId hoặc command' });
    }
    
    // Validate command
    const validCommands = ['PUMP_ON', 'PUMP_OFF', 'SET_MODE', 'SET_THRESHOLD', 'SCHEDULE', 'REBOOT'];
    if (!validCommands.includes(command)) {
      return res.status(400).json({ 
        error: 'Command không hợp lệ',
        validCommands 
      });
    }
    
    // Tạo command trong DB
    const cmd = await Command.create({
      deviceId,
      command,
      params: params || {},
      issuedBy: req.user._id,
      status: 'pending'
    });
    
    // Log audit
    await AuditLog.create({
      userId: req.user._id,
      deviceId,
      action: 'COMMAND_CREATED',
      details: { command, params },
      ipAddress: req.ip
    });
    
    res.status(201).json({
      success: true,
      message: 'Lệnh đã được tạo và sẽ được gửi xuống device',
      data: cmd
    });
    
  } catch (err) {
    console.error('Create command error:', err);
    res.status(500).json({ error: 'Lỗi tạo lệnh: ' + err.message });
  }
});

// Lấy chi tiết 1 lệnh
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const command = await Command.findById(req.params.id)
      .populate('issuedBy', 'username email');
    
    if (!command) {
      return res.status(404).json({ error: 'Lệnh không tồn tại' });
    }
    
    // Kiểm tra quyền xem
    if (req.user.role !== 'admin') {
      const device = await Device.findOne({ deviceId: command.deviceId });
      
      if (!device || 
          (device.owner && device.owner.toString() !== req.user._id.toString() &&
           !device.sharedWith.includes(req.user._id))) {
        return res.status(403).json({ error: 'Không có quyền xem lệnh này' });
      }
    }
    
    res.json({
      success: true,
      data: command
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy thông tin lệnh' });
  }
});

// Cập nhật trạng thái lệnh (thường do server tự động gọi khi gửi/nhận phản hồi)
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, error } = req.body;
    
    const validStatuses = ['pending', 'sent', 'completed', 'failed', 'timeout'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status không hợp lệ' });
    }
    
    const updateData = { status };
    
    if (status === 'sent') updateData.sentAt = new Date();
    if (status === 'completed' || status === 'failed') {
      updateData.completedAt = new Date();
    }
    if (error) updateData.error = error;
    
    const command = await Command.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!command) {
      return res.status(404).json({ error: 'Lệnh không tồn tại' });
    }
    
    res.json({
      success: true,
      message: 'Cập nhật trạng thái lệnh thành công',
      data: command
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật trạng thái lệnh' });
  }
});

// Hủy lệnh (chỉ với lệnh pending)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const command = await Command.findById(req.params.id);
    
    if (!command) {
      return res.status(404).json({ error: 'Lệnh không tồn tại' });
    }
    
    if (command.status !== 'pending') {
      return res.status(400).json({ 
        error: 'Chỉ có thể hủy lệnh đang pending',
        currentStatus: command.status 
      });
    }
    
    // Kiểm tra quyền
    if (req.user.role !== 'admin' && 
        command.issuedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Chỉ người tạo lệnh hoặc admin mới có quyền hủy' });
    }
    
    await Command.findByIdAndDelete(req.params.id);
    
    await AuditLog.create({
      userId: req.user._id,
      deviceId: command.deviceId,
      action: 'COMMAND_CANCELLED',
      details: { commandId: command._id, command: command.command },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Đã hủy lệnh thành công'
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi hủy lệnh' });
  }
});

module.exports = router;
