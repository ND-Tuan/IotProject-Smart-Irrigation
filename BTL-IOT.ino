#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <WiFiManager.h> // Cài thư viện: WiFiManager by tzapu

// --- CẤU HÌNH WIFI & MQTT ---
// WiFi sẽ được config qua WiFiManager portal (không cần hardcode)
const char* mqtt_server = "dff8f7471d7745a6907092c74b9267e6.s1.eu.hivemq.cloud"; 
const int mqtt_port = 8883; 
const char* mqtt_user = "Project220251";
const char* mqtt_pass = "Project220251";

WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- DEVICE ID (Tự động tạo từ MAC) ---
String deviceId;

// --- CẤU HÌNH CHÂN ---
#define SOIL_PIN 36   // GPIO36 (VP) - Chân analog cho cảm biến độ ẩm đất (joystick)
#define RELAY_PIN 22  // GPIO22 - Chân điều khiển relay bơm
#define DHTPIN 4      // GPIO4 - Chân Data của DHT (Nhiệt độ & Độ ẩm KK)
#define DHTTYPE DHT22 // Chọn loại cảm biến: DHT11 hoặc DHT22

DHT dht(DHTPIN, DHTTYPE);

// --- CẤU HÌNH NGƯỢNG BƠM ---
int DRY = 4095;
int WET = 1200;
int START = 40;
int STOP = 45;

// --- BIẾN TRẠNG THÁI ---
bool isAuto = true;      
bool active = false;       
bool manual = false;  

unsigned long lastPublish = 0;
const unsigned long publishInterval = 3000;
String clientId;

// --- HÀM XỬ LÝ LỆNH TỪ WEB ---
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("Nhan duoc: "); Serial.println(message);
  
  String topicStr = String(topic);
  
  // New format: iot/{deviceId}/command/{cmd}
  if (topicStr.startsWith("iot/" + deviceId + "/command/")) {
    String cmd = topicStr.substring(String("iot/" + deviceId + "/command/").length());
    
    if (cmd == "mode") {
      if (message == "AUTO") {
        isAuto = true;
      } else if (message == "MANUAL") {
        isAuto = false;
        manual = active;
      }
      String modeTopic = "iot/" + deviceId + "/status/mode";
      client.publish(modeTopic.c_str(), isAuto ? "AUTO" : "MANUAL");
    }
    else if (cmd == "pump") {
      if (!isAuto) {
        if (message == "ON") manual = true;
        else if (message == "OFF") manual = false;
      }
    }
    else if (cmd == "threshold") {
      int commaIndex = message.indexOf(',');
      if (commaIndex > 0) {
        String startStr = message.substring(0, commaIndex);
        String stopStr = message.substring(commaIndex + 1);
        
        int newStart = startStr.toInt();
        int newStop = stopStr.toInt();
        
        START = constrain(newStart, 0, 100);
        STOP = constrain(newStop, 0, 100);
        if (STOP <= START) STOP = START + 5;
        
        Serial.println("🎯 CẬP NHẬT NGƯỠNG THÀNH CÔNG!");
        Serial.print("   Bật bơm: "); Serial.print(START);
        Serial.print("% | Tắt bơm: "); Serial.print(STOP); Serial.println("%");
      }
    }
    return;
  }
}

void setup_wifi() {
  Serial.println("Starting WiFiManager...");
  
  // Tạo deviceId từ MAC address trước
  uint64_t chipid = ESP.getEfuseMac();
  deviceId = "ESP32_" + String((uint32_t)(chipid >> 32), HEX) + String((uint32_t)chipid, HEX);
  deviceId.toUpperCase();
  
  // Tạo WiFiManager instance
  WiFiManager wm;
  
  // Uncomment dòng dưới để xóa WiFi đã lưu (dùng khi test)
  // wm.resetSettings();
  
  // Tên Access Point: SmartGarden_ESP32_xxxxx
  String apName = "SmartGarden_" + deviceId;
  
  // Auto connect - nếu chưa có WiFi đã lưu, tạo AP config portal
  // Access Point không có password (mở)
  wm.setConfigPortalTimeout(180); // Timeout 3 phút
  
  if (!wm.autoConnect(apName.c_str())) {
    Serial.println("Failed to connect - restarting...");
    delay(3000);
    ESP.restart();
  }
  
  Serial.println("\nWiFi connected!");
  Serial.print("IP: "); Serial.println(WiFi.localIP());
  Serial.print("Device ID: "); Serial.println(deviceId);
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("MQTT connecting...");
    
    // Sử dụng deviceId làm clientId
    if (client.connect(deviceId.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("connected");
      
      // Subscribe new format: iot/{deviceId}/command/#
      String cmdTopic = "iot/" + deviceId + "/command/#";
      bool sub1 = client.subscribe(cmdTopic.c_str());
      Serial.print("Subscribe "); Serial.print(cmdTopic); Serial.print(": ");
      Serial.println(sub1 ? "OK" : "FAIL");
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

  // Tạo deviceId từ MAC address của ESP32
  uint64_t chipid = ESP.getEfuseMac();
  deviceId = "ESP32_" + String((uint32_t)chipid, HEX);
  clientId = "ESP32Soil-" + String((uint32_t)(chipid >> 32), HEX) + String((uint32_t)chipid, HEX);
  
  Serial.print("Device ID: "); Serial.println(deviceId);
  Serial.print("Client ID: "); Serial.println(clientId);
  
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

  // Gửi dữ liệu định kỳ (Mỗi 3 giây - Real-time)
  if (now - lastPublish >= publishInterval) {
    lastPublish = now;
    
    // Đọc nhiệt độ, độ ẩm KK (DHT chính)
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    // Kiểm tra nếu đọc lỗi
    if (isnan(h) || isnan(t)) {
      Serial.println(F("Loi doc DHT sensor!"));
      h = 0; t = 0;
    }
    
    // Đọc độ ẩm đất từ cảm biến analog
    int soilPct = readSoilPercent();

    char buf[10];
    
    // NEW FORMAT: Publish to iot/{deviceId}/sensor/{type}
    String baseTopic = "iot/" + deviceId + "/sensor/";
    
    dtostrf(t, 1, 1, buf);
    client.publish((baseTopic + "temp").c_str(), buf);
    
    dtostrf(h, 1, 1, buf);
    client.publish((baseTopic + "hum").c_str(), buf);
    
    sprintf(buf, "%d", soilPct);
    client.publish((baseTopic + "soil").c_str(), buf);
    
    // Publish pump status
    String pumpTopic = "iot/" + deviceId + "/status/pump";
    client.publish(pumpTopic.c_str(), active ? "ON" : "OFF");
    
    Serial.print("Sent - Device: "); Serial.print(deviceId);
    Serial.print(" | T: "); Serial.print(t);
    Serial.print("°C | H: "); Serial.print(h);
    Serial.print("% | Soil: "); Serial.print(soilPct);
    Serial.print("% | Pump: "); Serial.println(active ? "ON" : "OFF");
  }
    
}