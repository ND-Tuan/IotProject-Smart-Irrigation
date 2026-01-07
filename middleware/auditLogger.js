const AuditLog = require('../models/AuditLog');

// Middleware ghi audit log cho mọi request thành công
function auditLogger(req, res, next) {
  // Skip logging cho các endpoint không quan trọng
  const skipPaths = ['/api/health', '/api/ping', '/favicon.ico'];
  if (skipPaths.includes(req.path)) {
    return next();
  }
  
  const originalJson = res.json;
  
  res.json = function(data) {
    // Chỉ log nếu response thành công (< 400)
    if (res.statusCode < 400 && req.user) {
      AuditLog.create({
        userId: req.user._id,
        deviceId: req.device?.deviceId || req.body?.deviceId || req.query?.deviceId,
        action: `${req.method} ${req.path}`,
        details: {
          body: req.body,
          query: req.query,
          params: req.params
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        success: true
      }).catch(err => console.error('Audit log error:', err));
    }
    
    return originalJson.call(this, data);
  };
  
  next();
}

module.exports = { auditLogger };
