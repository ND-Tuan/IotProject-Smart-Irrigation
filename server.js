// server.js (Bản chuẩn - Đã đổi cổng 3001)
const express = require("express");
const mqtt = require("mqtt");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// --- 1. CẤU HÌNH SERVER ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Phục vụ file giao diện trong thư mục 'public'
app.use(express.static(path.join(__dirname, "public")));

// --- 2. KHỞI TẠO DATABASE SQLITE ---
const db = new sqlite3.Database("./garden.db", (err) => {
  if (err) console.error("Lỗi mở Database:", err.message);
  else console.log("Đã kết nối tới Database SQLite (garden.db)");
});

// Tạo bảng lưu trữ nếu chưa có
db.run(`CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temp REAL,
    hum REAL,
    soil REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Bảng lưu lịch sử bật/tắt bơm
db.run(`CREATE TABLE IF NOT EXISTS pump_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    mode TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Bảng lưu lịch tưới
db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT,
    days TEXT DEFAULT '[]',
    duration INTEGER,
    enabled INTEGER DEFAULT 1
)`);

// Bảng lưu cài đặt hệ thống
db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
)`, function(err) {
  if (err) console.error('Lỗi tạo bảng settings:', err.message);
  else {
    // Khởi tạo giá trị mặc định cho threshold nếu chưa có
    db.get("SELECT value FROM settings WHERE key = 'threshold_start'", (err, row) => {
      if (!row) {
        db.run("INSERT INTO settings (key, value) VALUES ('threshold_start', '40')");
        db.run("INSERT INTO settings (key, value) VALUES ('threshold_stop', '45')");
        console.log('Đã khởi tạo ngưỡng mặc định: 40-45%');
      }
    });
  }
});

// Hàm xóa dữ liệu cũ hơn 3 tháng
function cleanOldData() {
  const sql1 = `DELETE FROM measurements WHERE timestamp < datetime('now', '-3 months')`;
  const sql2 = `DELETE FROM pump_logs WHERE timestamp < datetime('now', '-3 months')`;
  
  db.run(sql1, function(err) {
    if (err) console.error('Lỗi xóa dữ liệu cũ measurements:', err.message);
    else if (this.changes > 0) console.log(`Đã xóa ${this.changes} bản ghi measurements cũ hơn 3 tháng`);
  });
  
  db.run(sql2, function(err) {
    if (err) console.error('Lỗi xóa dữ liệu cũ pump_logs:', err.message);
    else if (this.changes > 0) console.log(`Đã xóa ${this.changes} bản ghi pump_logs cũ hơn 3 tháng`);
  });
}

// Chạy mỗi 1 giờ
setInterval(cleanOldData, 3600000);
cleanOldData(); // Chạy ngay lần đầu

// --- 3. CẤU HÌNH MQTT ---
const mqttHost =
  "mqtts://dff8f7471d7745a6907092c74b9267e6.s1.eu.hivemq.cloud:8883";
const mqttOptions = {
  username: "Project220251",
  password: "Project220251",
  rejectUnauthorized: false,
};
const mqttClient = mqtt.connect(mqttHost, mqttOptions);

// Tracking thời gian lưu database (mỗi 5 phút)
let lastSaveTime = 0;
const SAVE_INTERVAL = 5 * 60 * 1000; // 5 phút

// Biến tạm lưu giá trị hiện tại của 3 cảm biến
let currentSensorData = {
  temp: null,
  hum: null,
  soil: null
};

// --- 4. XỬ LÝ LOGIC ---
mqttClient.on("connect", () => {
  console.log("Backend đã kết nối HiveMQ!");
  mqttClient.subscribe("iot/#");
});

// Biến lưu trạng thái bơm hiện tại và mode
let currentPumpState = null;
let currentMode = 'AUTO';

// Hàm lưu dữ liệu cảm biến vào database
function saveSensorData() {
  // Chỉ lưu nếu có đủ cả 3 giá trị
  if (currentSensorData.temp !== null && currentSensorData.hum !== null && currentSensorData.soil !== null) {
    // Tạo timestamp theo giờ Việt Nam (UTC+7)
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const timestamp = vnTime.toISOString().replace('T', ' ').slice(0, 19);
    
    const sql = `INSERT INTO measurements (temp, hum, soil, timestamp) VALUES (?, ?, ?, ?)`;
    db.run(sql, [currentSensorData.temp, currentSensorData.hum, currentSensorData.soil, timestamp], function (err) {
      if (err) return console.error("Lỗi lưu DB:", err.message);
      console.log(`Đã lưu measurements: temp=${currentSensorData.temp}, hum=${currentSensorData.hum}, soil=${currentSensorData.soil}, time=${timestamp}`);
    });
  }
}

mqttClient.on("message", (topic, message) => {
  const payload = message.toString();
  console.log(`[${topic}]: ${payload}`);

  // A. Gửi xuống Web ngay lập tức (Real-time)
  io.emit("mqtt-message", { topic, payload });

  // B. Cập nhật dữ liệu cảm biến hiện tại
  if (topic === "iot/temp") {
    currentSensorData.temp = parseFloat(payload);
  } else if (topic === "iot/hum") {
    currentSensorData.hum = parseFloat(payload);
  } else if (topic === "iot/soil") {
    currentSensorData.soil = parseFloat(payload);
  }
  
  // C. Lưu vào Database mỗi 5 phút (nếu đủ dữ liệu)
  if (topic === "iot/soil" || topic === "iot/temp" || topic === "iot/hum") {
    const now = Date.now();
    if (now - lastSaveTime >= SAVE_INTERVAL) {
      lastSaveTime = now;
      saveSensorData();
    }
  }
  
  // D. Lưu lịch sử bật/tắt bơm
  if (topic === "iot/pump" && payload !== currentPumpState) {
    currentPumpState = payload;
    // Tạo timestamp theo giờ Việt Nam (UTC+7)
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const timestamp = vnTime.toISOString().replace('T', ' ').slice(0, 19);
    
    const sql = `INSERT INTO pump_logs (action, mode, timestamp) VALUES (?, ?, ?)`;
    db.run(sql, [payload, currentMode, timestamp], function (err) {
      if (err) return console.error("Lỗi lưu pump log:", err.message);
      console.log(`Đã lưu pump log: ${payload} (${currentMode}) at ${timestamp}`);
    });
  }
  
  // E. Cập nhật mode hiện tại
  if (topic === "iot/mode") {
    currentMode = payload;
    console.log(`Chuyển chế độ: ${currentMode}`);
  }
});

// --- 5. TẠO API LẤY LỊCH SỬ ---
app.get("/api/history", (req, res) => {
  // Lấy 10 dòng mới nhất
  const sql = "SELECT * FROM measurements ORDER BY id DESC LIMIT 10";
  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", data: rows });
  });
});

// API lấy lịch sử bật/tắt bơm
app.get("/api/pump-history", (req, res) => {
  const sql = "SELECT * FROM pump_logs ORDER BY id DESC LIMIT 20";
  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", data: rows });
  });
});

// API lấy thống kê bơm
app.get("/api/pump-stats", (req, res) => {
  const period = req.query.period || 'day';
  let timeFilter = '-1 day';
  if (period === 'week') timeFilter = '-7 days';
  else if (period === 'month') timeFilter = '-30 days';
  
  const sql = `
    SELECT 
      COUNT(*) as total_switches,
      SUM(CASE WHEN action = 'ON' THEN 1 ELSE 0 END) as on_count,
      SUM(CASE WHEN action = 'OFF' THEN 1 ELSE 0 END) as off_count,
      SUM(CASE WHEN mode = 'AUTO' THEN 1 ELSE 0 END) as auto_count,
      SUM(CASE WHEN mode = 'MANUAL' THEN 1 ELSE 0 END) as manual_count
    FROM pump_logs 
    WHERE timestamp >= datetime('now', '${timeFilter}')
  `;
  
  db.get(sql, [], (err, row) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", data: row });
  });
});

// API lấy threshold settings
app.get("/api/threshold", (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'threshold_start'", (err, startRow) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    db.get("SELECT value FROM settings WHERE key = 'threshold_stop'", (err, stopRow) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ 
        message: "success", 
        data: { 
          start: startRow ? parseInt(startRow.value) : 40,
          stop: stopRow ? parseInt(stopRow.value) : 45
        } 
      });
    });
  });
});

// API cập nhật threshold settings
app.post("/api/threshold", express.json(), (req, res) => {
  const { start, stop } = req.body;
  
  if (!start || !stop) {
    res.status(400).json({ error: "Missing start or stop value" });
    return;
  }
  
  if (parseInt(stop) <= parseInt(start)) {
    res.status(400).json({ error: "Stop value must be greater than start value" });
    return;
  }
  
  // Cập nhật database
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('threshold_start', ?)", [start.toString()], (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('threshold_stop', ?)", [stop.toString()], (err) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      
      console.log(`Đã cập nhật ngưỡng: ${start}-${stop}%`);
      
      // Gửi lệnh xuống ESP32 qua MQTT
      const message = `${start},${stop}`;
      mqttClient.publish('iot/cmd/threshold', message, (err) => {
        if (err) {
          console.error('Lỗi gửi threshold xuống ESP32:', err);
        } else {
          console.log(`Đã gửi threshold xuống ESP32: ${message}`);
        }
      });
      
      res.json({ 
        message: "success",
        data: { start: parseInt(start), stop: parseInt(stop) }
      });
    });
  });
});

// API lấy dữ liệu dashboard mới nhất (từ MQTT real-time)
app.get("/api/current-data", (req, res) => {
  // Trả về dữ liệu real-time từ MQTT, không lấy từ database
  res.json({ 
    message: "success", 
    data: {
      temp: currentSensorData.temp,
      hum: currentSensorData.hum,
      soil: currentSensorData.soil,
      pump: currentPumpState,
      mode: currentMode
    }
  });
});

// API quản lý lịch tưới
app.get("/api/schedules", (req, res) => {
  const sql = "SELECT * FROM schedules ORDER BY time ASC";
  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", data: rows });
  });
});

app.post("/api/schedules", express.json(), (req, res) => {
  const { time, days, duration } = req.body;
  const daysJson = JSON.stringify(days || []);
  const sql = `INSERT INTO schedules (time, days, duration) VALUES (?, ?, ?)`;
  db.run(sql, [time, daysJson, duration], function(err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", id: this.lastID });
  });
});

app.delete("/api/schedules/:id", (req, res) => {
  const id = req.params.id;
  const sql = `DELETE FROM schedules WHERE id = ?`;
  db.run(sql, [id], function(err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success" });
  });
});

app.put("/api/schedules/:id", express.json(), (req, res) => {
  const id = req.params.id;
  const { time, days, duration, enabled } = req.body;
  
  // Nếu chỉ cập nhật enabled (toggle)
  if (enabled !== undefined && !time && !days) {
    const sql = `UPDATE schedules SET enabled = ? WHERE id = ?`;
    db.run(sql, [enabled, id], function(err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ message: "success" });
    });
  } 
  // Nếu cập nhật đầy đủ (từ modal edit)
  else {
    const daysJson = JSON.stringify(days || []);
    const sql = `UPDATE schedules SET time = ?, days = ?, duration = ?, enabled = ? WHERE id = ?`;
    db.run(sql, [time, daysJson, duration || 60, enabled !== undefined ? enabled : 1, id], function(err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ message: "success" });
    });
  }
});

// API lấy dữ liệu cho biểu đồ
app.get("/api/chart-data", (req, res) => {
  const period = req.query.period || 'day';
  let sql = '';
  
  if (period === 'day') {
    // 24h gần nhất: Lấy tất cả dữ liệu thô (mỗi 5 phút)
    sql = `
      SELECT id, temp, hum, soil, timestamp
      FROM measurements 
      WHERE timestamp >= datetime('now', '-1 day')
      ORDER BY timestamp ASC
    `;
  } else if (period === 'week') {
    // 7 ngày gần nhất: Nhóm theo giờ
    sql = `
      SELECT 
        AVG(temp) as temp,
        AVG(hum) as hum,
        AVG(soil) as soil,
        strftime('%Y-%m-%d %H:00', timestamp) as timestamp
      FROM measurements 
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY strftime('%Y-%m-%d %H:00', timestamp)
      ORDER BY timestamp ASC
    `;
  } else if (period === 'month') {
    // 30 ngày gần nhất: Nhóm theo ngày
    sql = `
      SELECT 
        AVG(temp) as temp,
        AVG(hum) as hum,
        AVG(soil) as soil,
        strftime('%Y-%m-%d', timestamp) as timestamp
      FROM measurements 
      WHERE timestamp >= datetime('now', '-30 days')
      GROUP BY strftime('%Y-%m-%d', timestamp)
      ORDER BY timestamp ASC
    `;
  }
  
  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: "success", data: rows });
  });
});

// --- 6. LOGIC LỊCH TƯỚI TỰ ĐỘNG ---
function checkSchedules() {
  const now = new Date();
  const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                     now.getMinutes().toString().padStart(2, '0');
  const currentDay = now.getDay(); // 0=CN, 1=T2, 2=T3, ..., 6=T7
  
  const sql = `SELECT * FROM schedules WHERE enabled = 1 AND time = ?`;
  db.all(sql, [currentTime], (err, rows) => {
    if (err) return console.error('Lỗi kiểm tra lịch:', err.message);
    
    rows.forEach(schedule => {
      // Parse days từ JSON
      let days = [];
      try {
        days = JSON.parse(schedule.days || '[]');
      } catch (e) {
        days = [];
      }
      
      // Kiểm tra xem ngày hiện tại có trong danh sách không
      if (days.length === 0 || days.includes(currentDay)) {
        console.log(`Kích hoạt lịch tưới: ${schedule.time} - ${schedule.duration}s`);
        mqttClient.publish('iot/cmd/schedule', `${schedule.duration}`);
      }
    });
  });
}

// Kiểm tra lịch mỗi phút
setInterval(checkSchedules, 60000);

// --- 7. SOCKET IO (NHẬN LỆNH TỪ WEB) ---
io.on("connection", (socket) => {
  socket.on("control-command", (data) => {
    console.log(`Web lệnh: ${data.topic} -> ${data.message}`);
    mqttClient.publish(data.topic, data.message);
  });
});

// --- 8. CHẠY SERVER (CỔNG 3001) ---
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server chạy tại: http://localhost:${PORT}`);
});
