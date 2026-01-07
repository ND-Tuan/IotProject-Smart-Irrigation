const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

// Rate limiting cho login (chống brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 5, // 5 requests
  message: { error: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.' }
});

// Đăng ký user mới
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }
    
    // Kiểm tra username đã tồn tại
    const existingUser = await User.findOne({ 
      $or: [{ username }, { email }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        error: 'Username hoặc email đã được sử dụng' 
      });
    }
    
    // Tạo user mới (role mặc định là 'user', không cho phép đăng ký admin)
    const user = await User.create({
      username,
      email,
      password, // Sẽ được hash tự động bởi pre-save hook
      role: role && role === 'viewer' ? 'viewer' : 'user' // Chỉ cho phép user hoặc viewer
    });
    
    // Tạo JWT token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '7d' }
    );
    
    // Log audit
    await AuditLog.create({
      userId: user._id,
      action: 'USER_REGISTERED',
      details: { username, email, role: user.role },
      ipAddress: req.ip
    });
    
    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Lỗi đăng ký: ' + err.message });
  }
});

// Đăng nhập
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Thiếu username hoặc password' });
    }
    
    // Tìm user (cho phép đăng nhập bằng username hoặc email)
    const user = await User.findOne({
      $or: [{ username }, { email: username }]
    });
    
    if (!user) {
      // Log failed login
      await AuditLog.create({
        action: 'LOGIN_FAILED',
        details: { username, reason: 'User not found' },
        ipAddress: req.ip,
        success: false
      });
      
      return res.status(401).json({ error: 'Username hoặc password không đúng' });
    }
    
    // So sánh password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      // Log failed login
      await AuditLog.create({
        userId: user._id,
        action: 'LOGIN_FAILED',
        details: { username, reason: 'Wrong password' },
        ipAddress: req.ip,
        success: false
      });
      
      return res.status(401).json({ error: 'Username hoặc password không đúng' });
    }
    
    // Cập nhật lastLogin
    user.lastLogin = new Date();
    await user.save();
    
    // Tạo JWT token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '7d' }
    );
    
    // Log successful login
    await AuditLog.create({
      userId: user._id,
      action: 'LOGIN_SUCCESS',
      details: { username },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Đăng nhập thành công',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin
      }
    });
    
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Lỗi đăng nhập: ' + err.message });
  }
});

// Lấy thông tin user hiện tại (cần JWT)
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      createdAt: req.user.createdAt,
      lastLogin: req.user.lastLogin
    }
  });
});

// Refresh token
router.post('/refresh', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const token = jwt.sign(
      { userId: req.user._id, role: req.user.role },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi refresh token' });
  }
});

// Đổi mật khẩu
router.post('/change-password', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    // Validate input
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Thiếu mật khẩu cũ hoặc mật khẩu mới' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }
    
    // Tìm user
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }
    
    // Kiểm tra mật khẩu cũ
    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      await AuditLog.create({
        userId: user._id,
        action: 'CHANGE_PASSWORD_FAILED',
        details: { reason: 'Mật khẩu cũ không đúng' },
        ipAddress: req.ip
      });
      return res.status(400).json({ error: 'Mật khẩu cũ không đúng' });
    }
    
    // Cập nhật mật khẩu mới (sẽ tự động hash qua pre-save hook)
    user.password = newPassword;
    await user.save();
    
    // Log audit
    await AuditLog.create({
      userId: user._id,
      action: 'CHANGE_PASSWORD_SUCCESS',
      details: { changedAt: new Date() },
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công'
    });
    
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Lỗi đổi mật khẩu: ' + err.message });
  }
});

// Lấy danh sách users (chỉ Admin)
router.get('/users', require('../middleware/auth').authMiddleware, require('../middleware/auth').checkRole('admin'), async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: users.length,
      users
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy danh sách users' });
  }
});

module.exports = router;
