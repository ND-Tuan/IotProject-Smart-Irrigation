# 🌱 IoT Smart Irrigation System - API Documentation

## 📦 Cài đặt

```bash
npm install
```

## ⚙️ Cấu hình

1. Copy file `.env.example` thành `.env`:
```bash
cp .env.example .env
```

2. Cập nhật các giá trị trong `.env`:
- `MONGO_URI`: Connection string MongoDB của bạn
- `JWT_SECRET`: Key để mã hóa JWT token (đổi thành chuỗi ngẫu nhiên)
- `DEVICE_TOKEN_SECRET`: Key để xác thực devices

## 🚀 Chạy Server

```bash
npm start
```

Server sẽ chạy tại `http://localhost:3001`

## 👤 Tài khoản Admin Mặc định

Khi chạy lần đầu, hệ thống tự động tạo tài khoản admin:
- **Username**: `admin`
- **Password**: `admin123`
- **Email**: `admin@iot.com`

⚠️ **QUAN TRỌNG**: Đổi mật khẩu ngay sau khi đăng nhập lần đầu!

---

## 🔐 Authentication APIs

### 1. Đăng ký User
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "user123",
  "email": "user@example.com",
  "password": "password123",
  "role": "user"  // Optional: "user" | "viewer"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Đăng ký thành công",
  "token": "eyJhbGciOiJIUzI1NiIsInR...",
  "user": {
    "id": "...",
    "username": "user123",
    "email": "user@example.com",
    "role": "user"
  }
}
```

### 2. Đăng nhập
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Đăng nhập thành công",
  "token": "eyJhbGciOiJIUzI1NiIsInR...",
  "user": {
    "id": "...",
    "username": "admin",
    "email": "admin@iot.com",
    "role": "admin",
    "lastLogin": "2026-01-07T..."
  }
}
```

### 3. Lấy thông tin User hiện tại
```http
GET /api/auth/me
Authorization: Bearer <token>
```

---

## 🔧 Device Management APIs

### 1. Lấy danh sách Devices
```http
GET /api/devices
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "deviceId": "ESP32_A1B2C3D4",
      "name": "Device ESP32_A1B2C3D4",
      "type": "irrigation",
      "status": "active",
      "isOnline": true,
      "lastSeen": "2026-01-07T...",
      "owner": { "username": "admin", "email": "admin@iot.com" },
      "permissions": {
        "allowControl": true,
        "allowDataView": true
      }
    }
  ]
}
```

### 2. Approve Device mới (Admin only)
```http
POST /api/devices/:deviceId/approve
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "ownerId": "user_id_here",
  "allowControl": true
}
```

### 3. Cập nhật thông tin Device
```http
PUT /api/devices/:deviceId
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Hệ thống tưới vườn A",
  "metadata": {
    "location": "Vườn A",
    "note": "Test device"
  }
}
```

### 4. Share Device với User khác
```http
POST /api/devices/:deviceId/share
Authorization: Bearer <token>
Content-Type: application/json

{
  "userIds": ["user_id_1", "user_id_2"]
}
```

---

## 📊 Telemetry APIs

### 1. ESP32 gửi dữ liệu (không cần auth)
```http
POST /api/telemetry
Content-Type: application/json

{
  "deviceId": "ESP32_A1B2C3D4",
  "temp": 28.5,
  "hum": 65,
  "soil": 42
}
```

### 2. Lấy dữ liệu Telemetry
```http
GET /api/telemetry?deviceId=ESP32_A1B2C3D4&startTime=2026-01-01&endTime=2026-01-07&page=1&limit=100
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "deviceId": "ESP32_A1B2C3D4",
      "temp": 28.5,
      "hum": 65,
      "soil": 42,
      "timestamp": "2026-01-07T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 1500,
    "pages": 15
  }
}
```

### 3. Lấy dữ liệu mới nhất
```http
GET /api/telemetry/latest?deviceId=ESP32_A1B2C3D4
Authorization: Bearer <token>
```

---

## 🎮 Command & Control APIs

### 1. Gửi lệnh điều khiển
```http
POST /api/commands
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceId": "ESP32_A1B2C3D4",
  "command": "PUMP_ON",
  "params": {
    "duration": 300
  }
}
```

**Valid Commands:**
- `PUMP_ON`: Bật bơm
- `PUMP_OFF`: Tắt bơm
- `SET_MODE`: Đổi chế độ (AUTO/MANUAL)
- `SET_THRESHOLD`: Đặt ngưỡng tưới
- `SCHEDULE`: Tạo lịch tưới
- `REBOOT`: Khởi động lại device

### 2. Lấy danh sách lệnh
```http
GET /api/commands?deviceId=ESP32_A1B2C3D4&status=pending&limit=50
Authorization: Bearer <token>
```

### 3. Hủy lệnh (chỉ lệnh pending)
```http
DELETE /api/commands/:commandId
Authorization: Bearer <token>
```

---

## 📈 Monitoring APIs (Admin only)

### 1. Số lượng Devices Online
```http
GET /api/monitoring/devices-online
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 10,
    "online": 8,
    "offline": 2,
    "pending": 1
  }
}
```

### 2. Audit Logs
```http
GET /api/monitoring/logs?userId=...&deviceId=...&action=LOGIN&page=1&limit=100
Authorization: Bearer <admin_token>
```

### 3. Thống kê Tổng quan
```http
GET /api/monitoring/stats
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "users": 25,
    "devices": {
      "total": 10,
      "active": 8,
      "online": 6,
      "pending": 2
    },
    "auditLogs": 15420
  }
}
```

---

## 🔐 Phân Quyền (RBAC)

| Role | Permissions |
|------|-------------|
| **admin** | - Xem/quản lý tất cả devices<br>- Approve devices mới<br>- Xem audit logs<br>- Quản lý users |
| **user** | - Xem/điều khiển devices của mình<br>- Share devices<br>- Xem dữ liệu & lịch sử |
| **viewer** | - Chỉ xem devices được share<br>- Không điều khiển<br>- Xem dữ liệu read-only |

---

## 📡 MQTT Topics

### ESP32 Publish (New Format):
```
iot/{deviceId}/sensor/temp
iot/{deviceId}/sensor/hum
iot/{deviceId}/sensor/soil
iot/{deviceId}/status/pump
iot/{deviceId}/status/mode
```

### ESP32 Subscribe (New Format):
```
iot/{deviceId}/command/mode
iot/{deviceId}/command/pump
iot/{deviceId}/command/threshold
```

### Backward Compatible (Old Format):
```
iot/temp
iot/hum
iot/soil
iot/pump
iot/cmd/mode
iot/cmd/pump
iot/cmd/threshold
```

---

## 🛠️ Testing với Postman/cURL

### 1. Đăng nhập Admin
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 2. Lấy danh sách Devices (với token)
```bash
curl -X GET http://localhost:3001/api/devices \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 3. Gửi lệnh điều khiển
```bash
curl -X POST http://localhost:3001/api/commands \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "ESP32_A1B2C3D4",
    "command": "PUMP_ON",
    "params": {}
  }'
```

---

## 🐛 Troubleshooting

### Device không tự động đăng ký?
- Kiểm tra ESP32 đã gửi đúng format `iot/{deviceId}/sensor/temp`
- Xem logs server: `Device mới tự động đăng ký: ESP32_...`

### Token hết hạn?
- Token có thời hạn 7 ngày
- Gọi `/api/auth/refresh` để làm mới token

### Device status = pending?
- Admin cần approve device qua `/api/devices/:deviceId/approve`
- Sau khi approve, device mới có thể điều khiển được

---

## 📝 Notes

- Tất cả API (trừ `/api/auth` và `/api/telemetry POST`) đều cần JWT token
- Token gửi trong header: `Authorization: Bearer <token>`
- Audit logs tự động xóa sau 90 ngày
- Device offline nếu `lastSeen` > 5 phút

---

## 🎯 Next Steps

1. ✅ Đổi mật khẩu admin
2. ✅ Cập nhật JWT_SECRET trong .env
3. ✅ Upload code lên ESP32
4. ✅ Test đăng ký/đăng nhập
5. ✅ Approve devices mới
6. ✅ Test gửi lệnh điều khiển
