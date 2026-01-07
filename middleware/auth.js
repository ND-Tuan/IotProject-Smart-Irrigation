const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

// Middleware xác thực JWT cho người dùng
async function authMiddleware(req, res, next) {
  try {
    // Lấy token từ header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token không hợp lệ hoặc thiếu' });
    }
    
    const token = authHeader.substring(7); // Bỏ "Bearer "
    
    // Xác thực token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this');
    
    // Lấy thông tin user từ DB
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ error: 'User không tồn tại' });
    }
    
    // Gắn user vào request
    req.user = user;
    next();
    
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token đã hết hạn' });
    }
    return res.status(401).json({ error: 'Token không hợp lệ' });
  }
}

// Middleware kiểm tra role
function checkRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Chưa xác thực' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      // Log failed attempt
      AuditLog.create({
        userId: req.user._id,
        action: `UNAUTHORIZED_ACCESS: ${req.method} ${req.path}`,
        details: { requiredRole: allowedRoles, userRole: req.user.role },
        ipAddress: req.ip,
        success: false
      }).catch(console.error);
      
      return res.status(403).json({ 
        error: 'Không có quyền truy cập', 
        requiredRole: allowedRoles 
      });
    }
    
    next();
  };
}

module.exports = { authMiddleware, checkRole };
