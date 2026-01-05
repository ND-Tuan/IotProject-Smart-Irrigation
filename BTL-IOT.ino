#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h> // 1. Thêm thư viện DHT

// --- CẤU HÌNH WIFI & MQTT ---
const char* ssid = "Wokwi-GUEST";
const char* password = "";
const char* mqtt_server = "dff8f7471d7745a6907092c74b9267e6.s1.eu.hivemq.cloud"; 
const int mqtt_port = 8883; 
const char* mqtt_user = "Project220251";
const char* mqtt_pass = "Project220251";

WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- CẤU HÌNH CHÂN ---
#define SOIL_PIN 36   // GPIO36 (VP) - Chân analog cho cảm biến độ ẩm đất (joystick)
#define RELAY_PIN 22  // GPIO22 - Chân điều khiển relay bơm
#define DHTPIN 4      // GPIO4 - Chân Data của DHT (Nhiệt độ & Độ ẩm KK)
#define DHTTYPE DHT22 // Chọn loại cảm biến: DHT11 hoặc DHT22

DHT dht(DHTPIN, DHTTYPE); // Khởi tạo cảm biến DHT (nhiệt độ & độ ẩm KK)

// --- CẤU HÌNH NGƯỢNG BƠM (Có thể thay đổi từ Web) ---
int DRY = 4095;     // ESP32 ADC 12-bit (0-4095)
int WET = 1200;     // Điều chỉnh tương ứng cho 12-bit
int START = 40;     // Ngưỡng bật bơm (%) - Có thể thay đổi
int STOP = 45;      // Ngưỡng tắt bơm (%) - Có thể thay đổi

// --- BIẾN TRẠNG THÁI ---
bool isAuto = true;      
bool active = false;       
bool manual = false;  

unsigned long lastPublish = 0;
const unsigned long publishInterval = 3000; // 3 giây (real-time control) 
String clientId;

// --- HÀM XỬ LÝ LỆNH TỪ WEB ---
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("Nhan duoc: "); Serial.println(message);

  if (String(topic) == "iot/cmd/mode") {
    if (message == "AUTO") {
      isAuto = true;
    } else if (message == "MANUAL") {
      isAuto = false;
      manual = active; 
    }
    client.publish("iot/mode", isAuto ? "AUTO" : "MANUAL");
  }

  if (String(topic) == "iot/cmd/pump") {
    Serial.println("✅ Xử lý cmd/pump");
    if (!isAuto) { 
      if (message == "ON") manual = true;
      else if (message == "OFF") manual = false;
    }
  }

  // Nhận lệnh thay đổi ngưỡng
  if (String(topic) == "iot/cmd/threshold") {
    Serial.println("✅ Xử lý cmd/threshold");
    Serial.print("Raw message: '"); Serial.print(message); Serial.println("'");
    
    // Format: "START,STOP" ví dụ: "35,50"
    int commaIndex = message.indexOf(',');
    Serial.print("Comma index: "); Serial.println(commaIndex);
    
    if (commaIndex > 0) {
      String startStr = message.substring(0, commaIndex);
      String stopStr = message.substring(commaIndex + 1);
      
      Serial.print("Start string: '"); Serial.print(startStr); Serial.println("'");
      Serial.print("Stop string: '"); Serial.print(stopStr); Serial.println("'");
      
      int newStart = startStr.toInt();
      int newStop = stopStr.toInt();
      
      Serial.print("Parsed - Start: "); Serial.print(newStart);
      Serial.print(" | Stop: "); Serial.println(newStop);
      
      // Xác thực giá trị hợp lệ
      START = constrain(newStart, 0, 100);
      STOP = constrain(newStop, 0, 100);
      if (STOP <= START) STOP = START + 5; // Đảm bảo STOP > START
      
      Serial.println("🎯 CẬP NHẬT NGƯỠNG THÀNH CÔNG!");
      Serial.print("   Bật bơm: ");
      Serial.print(START);
      Serial.print("% | Tắt bơm: ");
      Serial.print(STOP);
      Serial.println("%");
      
      // Gửi lại xác nhận
      char buf[20];
      sprintf(buf, "%d,%d", START, STOP);
      client.publish("iot/threshold", buf);
      Serial.print("Đã gửi xác nhận: "); Serial.println(buf);
    } else {
      Serial.println("LỖI: Không tìm thấy dấu phẩy trong message!");
    }
  }
}

void setup_wifi() {
  delay(10);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("\nWiFi connected");
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("MQTT connecting...");
    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("connected");
      
      // Subscribe với debug
      bool sub1 = client.subscribe("iot/cmd/mode");
      Serial.print("Subscribe iot/cmd/mode: "); Serial.println(sub1 ? "OK" : "FAIL");
      
      bool sub2 = client.subscribe("iot/cmd/pump");
      Serial.print("Subscribe iot/cmd/pump: "); Serial.println(sub2 ? "OK" : "FAIL");
      
      bool sub3 = client.subscribe("iot/cmd/threshold");
      Serial.print("Subscribe iot/cmd/threshold: "); Serial.println(sub3 ? "OK" : "FAIL");
      
      // Gửi ngưỡng hiện tại khi kết nối
      char buf[20];
      sprintf(buf, "%d,%d", START, STOP);
      client.publish("iot/threshold", buf);
      Serial.print("Đã gửi ngưỡng hiện tại: "); Serial.println(buf);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" retrying in 3s");
      delay(3000);
    }
  }
}

int readSoilPercent() {
  int raw = analogRead(SOIL_PIN);  
  int pct = map(raw, DRY, WET, 0, 100); 
  return constrain(pct, 0, 100);
}

void setup() {
  Serial.begin(115200); 
  
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Khởi tạo TẮT relay (Active LOW)
  
  analogReadResolution(12); // Cấu hình ADC 12-bit cho ESP32
  
  dht.begin(); // Khởi động cảm biến DHT (nhiệt độ & độ ẩm KK)

  uint64_t chipid = ESP.getEfuseMac();
  clientId = "ESP32Soil-" + String((uint32_t)(chipid >> 32), HEX) + String((uint32_t)chipid, HEX);
  setup_wifi();
  
  espClient.setInsecure(); 
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop(); 

  unsigned long now = millis();
  
  // Logic điều khiển bơm (liên tục)
  // Đọc độ ẩm đất từ cảm biến analog (joystick)
  int soilPct = readSoilPercent();
  
  if (isAuto) {
    if (soilPct < START) active = true;
    else if (soilPct > STOP) active = false;
  } else {
    active = manual;
  } 
  // Relay module active LOW: LOW = BẬT, HIGH = TẮT
  digitalWrite(RELAY_PIN, active ? LOW : HIGH);

  // Gửi dữ liệu định kỳ (Mỗi 5 giây - Real-time)
  if (now - lastPublish >= publishInterval) {
    lastPublish = now;
    
    // Đọc nhiệt độ, độ ẩm KK (DHT chính)
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    // Kiểm tra nếu đọc lỗi (NaN = Not a Number)
    if (isnan(h) || isnan(t)) {
      Serial.println(F("Loi doc DHT sensor!"));
      h = 0; t = 0; // Gán tạm bằng 0 để không lỗi chuỗi
    }
    
    // Đọc độ ẩm đất từ cảm biến analog
    int soilPct = readSoilPercent();

    char buf[10];
    
    // Gửi Độ ẩm đất (từ DHT thứ hai)
    sprintf(buf, "%d", soilPct);
    client.publish("iot/soil", buf);

    // Gửi Nhiệt độ (Temp)
    sprintf(buf, "%.1f", t);
    client.publish("iot/temp", buf);

    // Gửi Độ ẩm KK (Hum)
    sprintf(buf, "%.1f", h);
    client.publish("iot/hum", buf);

    // Gửi trạng thái khác
    client.publish("iot/pump", active ? "ON" : "OFF");
    client.publish("iot/mode", isAuto ? "AUTO" : "MANUAL");

    Serial.print("T: "); Serial.print(t);
    Serial.print(" | H: "); Serial.print(h);
    Serial.print(" | Soil: "); Serial.print(soilPct);
    Serial.print("% | Pump: "); Serial.println(active ? "ON" : "OFF");
  }
}