require("dotenv").config();
const express = require("express");
const mqtt = require("mqtt");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");

// Cấu hình server
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("💾 MongoDB: Kết nối thành công!"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// Định nghĩa Schema
// 1. Bảng dữ liệu cảm biến (measurements)
const MeasurementSchema = new mongoose.Schema({
  temp: Number,
  hum: Number,
  soil: Number,
  timestamp: { type: Date, default: Date.now }
});

const Measurement = mongoose.model("Measurement", MeasurementSchema);

// 2. Bảng lịch sử bơm (pump_logs)
const PumpLogSchema = new mongoose.Schema({
  action: String, // 'ON' hoặc 'OFF'
  mode: String,   // 'AUTO' hoặc 'MANUAL'
  timestamp: { type: Date, default: Date.now }
});
const PumpLog = mongoose.model("PumpLog", PumpLogSchema);

// 3. Bảng lịch tưới (schedules)
const ScheduleSchema = new mongoose.Schema({
  time: String,      // "HH:MM"
  days: [Number],    // [0, 1, 2...] (0=CN)
  duration: Number,  // giây
  enabled: { type: Boolean, default: true }
});
const Schedule = mongoose.model("Schedule", ScheduleSchema);

// 4. Bảng cài đặt (settings)
const SettingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: String
});
const Setting = mongoose.model("Setting", SettingSchema);

// Khởi tạo ngưỡng mặc định
async function initSettings() {
  try {
    const start = await Setting.findOne({ key: "threshold_start" });
    if (!start) await Setting.create({ key: "threshold_start", value: "40" });
    
    const stop = await Setting.findOne({ key: "threshold_stop" });
    if (!stop) await Setting.create({ key: "threshold_stop", value: "45" });
    
    console.log("✅ Đã kiểm tra/khởi tạo cài đặt ngưỡng.");
  } catch (e) { console.error("Lỗi init settings:", e); }
}
initSettings();

// Cấu hình MQTT
const mqttClient = mqtt.connect(process.env.MQTT_HOST, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: false,
});

// Biến lưu trạng thái tạm
let currentSensorData = { temp: null, hum: null, soil: null };
let currentPumpState = null;
let currentMode = 'AUTO';
let lastSaveTime = 0;
const SAVE_INTERVAL = 5000; // 5s để kiểm thử, thực tế đặt 5 phút lấy dữ liệu 1 lần

mqttClient.on("connect", () => {
  console.log("✅ MQTT: Đã kết nối HiveMQ!");
  mqttClient.subscribe("iot/#");
});

mqttClient.on("message", async (topic, message) => {
  const payload = message.toString();
  console.log(`📩 [${topic}]: ${payload}`);

  // Gửi xuống Web (Real-time)
  io.emit("mqtt-message", { topic, payload });

  // Cập nhật biến tạm
  if (topic === "iot/temp") currentSensorData.temp = parseFloat(payload);
  else if (topic === "iot/hum") currentSensorData.hum = parseFloat(payload);
  else if (topic === "iot/soil") currentSensorData.soil = parseFloat(payload);

  // Lưu dữ liệu cảm biến (Mỗi 5 phút nếu đủ 3 chỉ số)
  if (["iot/soil", "iot/temp", "iot/hum"].includes(topic)) {
    const now = Date.now();
    if (now - lastSaveTime >= SAVE_INTERVAL) {
      if (currentSensorData.temp !== null && currentSensorData.soil !== null) {
        lastSaveTime = now;
        try {
          await Measurement.create(currentSensorData);
          console.log("💾 Đã lưu dữ liệu cảm biến vào MongoDB");
        } catch (e) { console.error("Lỗi lưu measurement:", e); }
      }
    }
  }

  // Lưu lịch sử bơm
  if (topic === "iot/pump" && payload !== currentPumpState) {
    currentPumpState = payload;
    try {
      await PumpLog.create({ action: payload, mode: currentMode });
      console.log(`💾 Đã lưu Pump Log: ${payload}`);
    } catch (e) { console.error("Lỗi lưu pump log:", e); }
  }

  // Cập nhật Mode
  if (topic === "iot/mode") {
    currentMode = payload;
    console.log(`🔄 Chế độ hiện tại: ${currentMode}`);
  }
});

// Các hàm API
// API lấy lịch sử đo (cho bảng lịch sử)
app.get("/api/history", async (req, res) => {
  try {
    const data = await Measurement.find().sort({ timestamp: -1 }).limit(10);
    res.json({ message: "success", data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API lấy lịch sử bơm
app.get("/api/pump-history", async (req, res) => {
  try {
    const data = await PumpLog.find().sort({ timestamp: -1 }).limit(20);
    res.json({ message: "success", data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API thống kê bơm (Pump Stats)
app.get("/api/pump-stats", async (req, res) => {
  try {
    const period = req.query.period || 'day';
    let dateFilter = new Date();
    if (period === 'day') dateFilter.setDate(dateFilter.getDate() - 1);
    else if (period === 'week') dateFilter.setDate(dateFilter.getDate() - 7);
    else if (period === 'month') dateFilter.setDate(dateFilter.getDate() - 30);

    const logs = await PumpLog.find({ timestamp: { $gte: dateFilter } });

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
    const start = await Setting.findOne({ key: "threshold_start" });
    const stop = await Setting.findOne({ key: "threshold_stop" });
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
    const { start, stop } = req.body;
    if (parseInt(stop) <= parseInt(start)) return res.status(400).json({ error: "Stop > Start" });

    await Setting.findOneAndUpdate({ key: "threshold_start" }, { value: start }, { upsert: true });
    await Setting.findOneAndUpdate({ key: "threshold_stop" }, { value: stop }, { upsert: true });

    // Gửi xuống ESP32
    mqttClient.publish('iot/cmd/threshold', `${start} -> ${stop}`);
    res.json({ message: "success", data: { start, stop } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API dữ liệu hiện tại
app.get("/api/current-data", (req, res) => {
  res.json({ 
    message: "success", 
    data: { ...currentSensorData, pump: currentPumpState, mode: currentMode } 
  });
});

// API quản lý lịch tưới (Schedules)
app.get("/api/schedules", async (req, res) => {
  try {
    const schedules = await Schedule.find().sort({ time: 1 });
    res.json({ message: "success", data: schedules });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/schedules", async (req, res) => {
  try {
    const newSchedule = await Schedule.create(req.body);
    res.json({ message: "success", id: newSchedule._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/schedules/:id", async (req, res) => {
  try {
    await Schedule.findByIdAndDelete(req.params.id);
    res.json({ message: "success" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/schedules/:id", async (req, res) => {
  try {
    await Schedule.findByIdAndUpdate(req.params.id, req.body);
    res.json({ message: "success" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API biểu đồ (Chart Data)
app.get("/api/chart-data", async (req, res) => {
  try {
    const period = req.query.period || 'day';
    let dateFilter = new Date();
    
    // Logic lọc thời gian
    if (period === 'day') dateFilter.setDate(dateFilter.getDate() - 1);
    else if (period === 'week') dateFilter.setDate(dateFilter.getDate() - 7);
    else if (period === 'month') dateFilter.setDate(dateFilter.getDate() - 30);

    const data = await Measurement.find({ timestamp: { $gte: dateFilter } })
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
        console.log(`⏰ Kích hoạt lịch tưới: ${sch.time} (${sch.duration}s)`);
        mqttClient.publish('iot/cmd/schedule', `${sch.duration}`);
      }
    });
  }).catch(e => console.error(e));
}
setInterval(checkSchedules, 60000); // Check mỗi phút

// Socket IO nhận lệnh từ Web
io.on("connection", (socket) => {
  console.log(`🔌 Web connected: ${socket.id}`);
  socket.on("control-command", (data) => {
    console.log(`📤 Web lệnh: ${data.topic} -> ${data.message}`);
    mqttClient.publish(data.topic, data.message);
  });
});

// Chạy Server
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});