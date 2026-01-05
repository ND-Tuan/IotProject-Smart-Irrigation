## Wokwi simulation:
https://wokwi.com/projects/452327798983077889
## Backend – Cấu hình môi trường

Backend sử dụng **biến môi trường (.env)** để cấu hình kết nối MongoDB và MQTT.

Tạo file `.env` trong thư mục gốc với nội dung:

```env
PORT=3001

MONGO_URI=mongodb+srv://<username>:<password>@<cluster>/<db_name>

MQTT_HOST=mqtts://xxxxx.s1.eu.hivemq.cloud:8883
MQTT_USER=your_mqtt_username
MQTT_PASS=your_mqtt_password
```

## Setup Backend
```
npm install
```
