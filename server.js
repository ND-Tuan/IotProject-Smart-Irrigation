require("dotenv").config();
const express = require("express");
const mqtt = require("mqtt");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");

// Import Models
const User = require("./models/User");
const Device = require("./models/Device");
const Command = require("./models/Command");
const AuditLog = require("./models/AuditLog");

// Import Middleware
const { authMiddleware, checkRole } = require("./middleware/auth");
const { auditLogger } = require("./middleware/auditLogger");

// Import Routes
const authRoutes = require("./routes/auth");
const deviceRoutes = require("./routes/devices");
const commandRoutes = require("./routes/commands");
const telemetryRoutes = require("./routes/telemetry");
const monitoringRoutes = require("./routes/monitoring");

// Cấu hình server
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB: Kết nối thành công!");
    initializeDefaultAdmin();
  })
  .catch((err) => console.error("MongoDB Error:", err));

// Import Models
const Measurement = require('./models/Measurement');
const PumpLog = require('./models/PumpLog');
const Schedule = require('./models/Schedule');
const Setting = require('./models/Setting');

// Khởi tạo tài khoản Admin mặc định
async function initializeDefaultAdmin() {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    
    if (!adminExists) {
      await User.create({
        username: 'admin',
        email: 'admin@iot.com',
        password: 'admin123', // Sẽ được hash tự động
        role: 'admin'
      });
      console.log("Đã tạo tài khoản admin mặc định:");
      console.log("   Username: admin");
      console.log("   Password: admin123");
      console.log("   QUAN TRỌNG: Đổi mật khẩu ngay sau khi đăng nhập lần đầu!");
    } else {
      console.log("Tài khoản admin đã tồn tại");
    }
  } catch (e) {
    console.error("Lỗi khởi tạo admin:", e);
  }
}

// Khởi tạo ngưỡng mặc định (Global settings)
async function initSettings() {
  try {
    // Xóa index cũ nếu tồn tại (fix lỗi E11000)
    try {
      await Setting.collection.dropIndex('key_1');
      console.log('Đã xóa index cũ key_1');
    } catch (e) {
      // Index không tồn tại, bỏ qua
    }
    
    const start = await Setting.findOne({ deviceId: null, key: "threshold_start" });
    if (!start) await Setting.create({ deviceId: null, key: "threshold_start", value: "40" });
    
    const stop = await Setting.findOne({ deviceId: null, key: "threshold_stop" });
    if (!stop) await Setting.create({ deviceId: null, key: "threshold_stop", value: "45" });
    
    console.log("Đã kiểm tra/khởi tạo cài đặt ngưỡng global.");
  } catch (e) { console.error("Lỗi init settings:", e); }
}
initSettings();

// Cấu hình MQTT
const mqttClient = mqtt.connect(process.env.MQTT_HOST, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: false,
});

// Cache dữ liệu realtime từ MQTT theo deviceId
const deviceDataCache = new Map(); // { deviceId: { temp, hum, soil, pump, mode, lastUpdate } }

// Cache timestamp lần lưu DB cuối cùng cho mỗi device (throttle 5s)
const lastSaveTimestamp = new Map(); // { deviceId: timestamp }
const SAVE_INTERVAL = 5000; // 5 giây

// Biến lưu trạng thái tạm (cho tracking mode)
let currentPumpState = null;
let currentMode = 'AUTO';


mqttClient.on("connect", () => {
  console.log("MQTT: Đã kết nối HiveMQ!");
  mqttClient.subscribe("iot/#");
});

mqttClient.on("message", async (topic, message) => {
  const payload = message.toString();
  console.log(`[${topic}]: ${payload}`);

  // Gửi xuống Web (Real-time)
  io.emit("mqtt-message", { topic, payload });

  // Parse topic: iot/{deviceId}/sensor/{type} hoặc iot/temp (backward compatible)
  const parts = topic.split('/');
  let deviceId = null;
  
  // New format: iot/{deviceId}/sensor/temp
  if (parts.length >= 4 && parts[0] === 'iot' && parts[2] === 'sensor') {
    deviceId = parts[1];
    const sensorType = parts[3]; // temp, hum, soil
    
    // Tự động đăng ký device nếu chưa có
    let device = await Device.findOne({ deviceId });
    if (!device) {
      try {
        device = await Device.create({
          deviceId,
          name: `Device ${deviceId}`,
          type: 'irrigation',
          status: 'pending',
          permissions: {
            allowControl: false,
            allowDataView: true
          }
        });
        console.log('Device mới tự động đăng ký:', deviceId);
        io.emit('new-device-registered', { deviceId, status: 'pending' });
      } catch (err) {
        if (err.code === 11000) {
          // Device vừa được tạo bởi request khác, fetch lại
          device = await Device.findOne({ deviceId });
        } else {
          throw err;
        }
      }
    }
    
    // Cập nhật lastSeen
    if (device) {
      device.lastSeen = new Date();
      await device.save();
    }
    
    // Cập nhật cache realtime
    if (!deviceDataCache.has(deviceId)) {
      deviceDataCache.set(deviceId, { temp: null, hum: null, soil: null, pump: null, mode: 'AUTO', lastUpdate: new Date() });
    }
    const cache = deviceDataCache.get(deviceId);
    const value = parseFloat(payload);
    cache[sensorType] = value;
    cache.lastUpdate = new Date();
    
    // Chỉ lưu vào DB khi có đủ cả 3 giá trị hợp lệ VÀ đã qua 5s kể từ lần lưu trước
    if (cache.temp !== null && cache.hum !== null && cache.soil !== null) {
      const now = Date.now();
      const lastSave = lastSaveTimestamp.get(deviceId) || 0;
      
      if (now - lastSave >= SAVE_INTERVAL) {
        try {
          await Measurement.create({ 
            deviceId, 
            temp: cache.temp, 
            hum: cache.hum, 
            soil: cache.soil 
          });
          lastSaveTimestamp.set(deviceId, now);
          console.log(`Đã lưu dữ liệu: ${deviceId} (T:${cache.temp}, H:${cache.hum}, S:${cache.soil})`);
        } catch (err) {
          console.error('Lỗi lưu Measurement:', err);
        }
      }
    }
    
    return;
  }
  
  // Lưu lịch sử bơm (New format with deviceId)
  if (parts.length >= 4 && parts[0] === 'iot' && parts[2] === 'status' && parts[3] === 'pump') {
    const deviceId = parts[1];
    const pumpState = payload;
    
    if (pumpState !== currentPumpState) {
      currentPumpState = pumpState;
      try {
        await PumpLog.create({ 
          deviceId, 
          action: pumpState, 
          mode: currentMode 
        });
        console.log(`Đã lưu Pump Log (${deviceId}): ${pumpState}`);
      } catch (e) { console.error("Lỗi lưu pump log:", e); }
    }
    
    // Cập nhật cache realtime
    if (!deviceDataCache.has(deviceId)) {
      deviceDataCache.set(deviceId, { temp: null, hum: null, soil: null, pump: null, mode: 'AUTO', lastUpdate: new Date() });
    }
    const cache = deviceDataCache.get(deviceId);
    cache.pump = pumpState;
    cache.lastUpdate = new Date();
  }
  
  // Cập nhật Mode (New format)
  if (parts.length >= 4 && parts[0] === 'iot' && parts[2] === 'status' && parts[3] === 'mode') {
    const deviceId = parts[1];
    currentMode = payload;
    console.log(`Chế độ (${deviceId}): ${currentMode}`);
    
    // Cập nhật cache realtime
    if (!deviceDataCache.has(deviceId)) {
      deviceDataCache.set(deviceId, { temp: null, hum: null, soil: null, pump: null, mode: 'AUTO', lastUpdate: new Date() });
    }
    const cache = deviceDataCache.get(deviceId);
    cache.mode = payload;
    cache.lastUpdate = new Date();
  }
});

// Các hàm API
// API lấy lịch sử đo (cho bảng lịch sử)
app.get("/api/history", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const query = deviceId ? { deviceId } : {};
    const data = await Measurement.find(query).sort({ timestamp: -1 }).limit(10);
    res.json({ message: "success", data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API lấy lịch sử bơm
app.get("/api/pump-history", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const query = deviceId ? { deviceId } : {};
    const data = await PumpLog.find(query).sort({ timestamp: -1 }).limit(20);
    res.json({ message: "success", data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API thống kê bơm (Pump Stats)
app.get("/api/pump-stats", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const period = req.query.period || 'day';
    let dateFilter = new Date();
    if (period === 'day') dateFilter.setDate(dateFilter.getDate() - 1);
    else if (period === 'week') dateFilter.setDate(dateFilter.getDate() - 7);
    else if (period === 'month') dateFilter.setDate(dateFilter.getDate() - 30);

    const query = { timestamp: { $gte: dateFilter } };
    if (deviceId) query.deviceId = deviceId;
    
    const logs = await PumpLog.find(query);

    const stats = {
      total_switches: logs.length,
      on_count: logs.filter(l => l.action === 'ON').length,
      off_count: logs.filter(l => l.action === 'OFF').length,
      auto_count: logs.filter(l => l.mode === 'AUTO').length,
      manual_count: logs.filter(l => l.mode === 'MANUAL').length
    };
    res.json({ message: "success", data: stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API lấy/cập nhật ngưỡng (Threshold)
app.get("/api/threshold", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const query = { deviceId: deviceId || null }; // null = global
    
    const start = await Setting.findOne({ ...query, key: "threshold_start" });
    const stop = await Setting.findOne({ ...query, key: "threshold_stop" });
    
    res.json({ 
      message: "success", 
      data: { 
        start: start ? parseInt(start.value) : 40, 
        stop: stop ? parseInt(stop.value) : 45 
      } 
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/threshold", async (req, res) => {
  try {
    const { deviceId, start, stop } = req.body;
    if (parseInt(stop) <= parseInt(start)) return res.status(400).json({ error: "Stop > Start" });

    const query = { deviceId: deviceId || null };
    
    await Setting.findOneAndUpdate(
      { ...query, key: "threshold_start" }, 
      { deviceId: deviceId || null, key: "threshold_start", value: start }, 
      { upsert: true }
    );
    await Setting.findOneAndUpdate(
      { ...query, key: "threshold_stop" }, 
      { deviceId: deviceId || null, key: "threshold_stop", value: stop }, 
      { upsert: true }
    );

    // Gửi xuống ESP32 (nếu có deviceId thì gửi riêng, không thì gửi global)
    if (deviceId) {
      mqttClient.publish(`iot/${deviceId}/command/threshold`, `${start},${stop}`);
    } else {
      mqttClient.publish('iot/cmd/threshold', `${start},${stop}`);
    }
    
    res.json({ message: "success", data: { start, stop } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API dữ liệu hiện tại
app.get("/api/current-data", async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ error: 'Thiếu deviceId' });
    }
    
    // Lấy từ cache realtime trước
    if (deviceDataCache.has(deviceId)) {
      const cache = deviceDataCache.get(deviceId);
      return res.json({ 
        message: "success", 
        data: {
          temp: cache.temp,
          hum: cache.hum,
          soil: cache.soil,
          pump: cache.pump,
          mode: cache.mode
        }
      });
    }
    
    // Nếu không có cache, lấy từ database
    const latestMeasurement = await Measurement.findOne({ deviceId })
      .sort({ timestamp: -1 })
      .limit(1);
    
    const latestPumpLog = await PumpLog.findOne({ deviceId })
      .sort({ timestamp: -1 })
      .limit(1);
    
    const data = {
      temp: latestMeasurement?.temp || null,
      hum: latestMeasurement?.hum || null,
      soil: latestMeasurement?.soil || null,
      pump: latestPumpLog?.action || null,
      mode: latestPumpLog?.mode || 'AUTO'
    };
    
    res.json({ message: "success", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API quản lý lịch tưới (Schedules)
app.get("/api/schedules", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const query = deviceId ? { deviceId } : {};
    const schedules = await Schedule.find(query)
      .populate('createdBy', 'username email')
      .sort({ time: 1 });
    res.json({ message: "success", data: schedules });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/schedules", async (req, res) => {
  try {
    // req.body phải có deviceId
    if (!req.body.deviceId) {
      return res.status(400).json({ error: "deviceId là bắt buộc" });
    }
    
    // Đảm bảo days là array
    const scheduleData = {
      ...req.body,
      days: Array.isArray(req.body.days) ? req.body.days : []
    };
    
    console.log('📅 Tạo lịch mới:', scheduleData);
    
    const newSchedule = await Schedule.create(scheduleData);
    res.json({ message: "success", id: newSchedule._id });
  } catch (err) { 
    console.error('Lỗi tạo schedule:', err);
    res.status(500).json({ error: err.message }); 
  }
});

app.delete("/api/schedules/:id", async (req, res) => {
  try {
    await Schedule.findByIdAndDelete(req.params.id);
    res.json({ message: "success" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/schedules/:id", async (req, res) => {
  try {
    // Đảm bảo days là array
    const updateData = {
      ...req.body,
      days: Array.isArray(req.body.days) ? req.body.days : []
    };
    
    console.log('📅 Cập nhật lịch:', req.params.id, updateData);
    
    await Schedule.findByIdAndUpdate(req.params.id, updateData);
    res.json({ message: "success" });
  } catch (err) { 
    console.error('Lỗi cập nhật schedule:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// API biểu đồ (Chart Data)
app.get("/api/chart-data", async (req, res) => {
  try {
    const period = req.query.period || 'day';
    const deviceId = req.query.deviceId;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Thiếu deviceId' });
    }
    
    let dateFilter = new Date();
    
    // Logic lọc thời gian
    if (period === 'day') dateFilter.setDate(dateFilter.getDate() - 1);
    else if (period === 'week') dateFilter.setDate(dateFilter.getDate() - 7);
    else if (period === 'month') dateFilter.setDate(dateFilter.getDate() - 30);

    const data = await Measurement.find({ 
      deviceId: deviceId,
      timestamp: { $gte: dateFilter } 
    })
      .sort({ timestamp: 1 })
      .limit(2000); 

    res.json({ message: "success", data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Hàm set lịch tưới tự động
function checkSchedules() {
  const now = new Date();
  const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                      now.getMinutes().toString().padStart(2, '0');
  const currentDay = now.getDay(); // 0-6

  Schedule.find({ enabled: true, time: currentTime }).then(schedules => {
    schedules.forEach(sch => {
      if (sch.days.length === 0 || sch.days.includes(currentDay)) {
        console.log(`Kích hoạt lịch tưới (${sch.deviceId}): ${sch.time} (${sch.duration}s)`);
        
        // Gửi xuống device cụ thể
        if (sch.deviceId) {
          mqttClient.publish(`iot/${sch.deviceId}/command/schedule`, `${sch.duration}`);
        } else {
          // Backward compatible - gửi global
          mqttClient.publish('iot/cmd/schedule', `${sch.duration}`);
        }
      }
    });
  }).catch(e => console.error(e));
}
setInterval(checkSchedules, 60000); // Check mỗi phút

// Command Queue Scheduler - Gửi lệnh pending xuống devices
async function processCommandQueue() {
  try {
    const pendingCommands = await Command.find({ status: 'pending' }).limit(10);
    
    for (const cmd of pendingCommands) {
      // Kiểm tra device có online không
      const device = await Device.findOne({ deviceId: cmd.deviceId });
      
      if (!device || device.status !== 'active') {
        await Command.findByIdAndUpdate(cmd._id, {
          status: 'failed',
          error: 'Device not active',
          completedAt: new Date()
        });
        continue;
      }
      
      // Check device có online không (lastSeen < 5 phút)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (!device.lastSeen || device.lastSeen < fiveMinutesAgo) {
        // Device offline, skip
        continue;
      }
      
      // Gửi lệnh xuống MQTT
      const topic = `iot/${cmd.deviceId}/command/${cmd.command.toLowerCase().replace('_', '/')}`;
      const payload = JSON.stringify(cmd.params);
      
      mqttClient.publish(topic, payload);
      
      // Cập nhật status = sent
      await Command.findByIdAndUpdate(cmd._id, {
        status: 'sent',
        sentAt: new Date()
      });
      
      console.log(`📤 Đã gửi lệnh ${cmd.command} xuống device ${cmd.deviceId}`);
      
      // Auto-complete sau 30s nếu không có phản hồi
      setTimeout(async () => {
        const cmdCheck = await Command.findById(cmd._id);
        if (cmdCheck && cmdCheck.status === 'sent') {
          await Command.findByIdAndUpdate(cmd._id, {
            status: 'timeout',
            completedAt: new Date(),
            error: 'No response from device'
          });
        }
      }, 30000);
    }
  } catch (err) {
    console.error('Command queue error:', err);
  }
}
setInterval(processCommandQueue, 5000); // Check mỗi 5 giây

// === MỚI: MOUNT API ROUTES ===
// Apply audit logger cho tất cả routes
app.use(auditLogger);

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes (cần authentication)
app.use('/api/devices', deviceRoutes);
app.use('/api/commands', commandRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/monitoring', monitoringRoutes);

// Socket IO nhận lệnh từ Web
io.on("connection", (socket) => {
  socket.on("control-command", (data) => {
    console.log(`Web lệnh: ${data.topic} -> ${data.message}`);
    mqttClient.publish(data.topic, data.message);
  });
});

// Export mqttClient để routes có thể sử dụng
app.set('mqttClient', mqttClient);
app.set('io', io);

// Chạy Server
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});