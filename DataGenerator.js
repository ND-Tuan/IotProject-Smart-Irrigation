// DataGenerator.js - Tạo dữ liệu giả cho bảng measurements (Phiên bản cải tiến)
const sqlite3 = require("sqlite3").verbose();

class DataGenerator {
  constructor(dbPath = "./garden.db") {
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Lỗi kết nối Database:", err.message);
      } else {
        console.log("Đã kết nối Database:", dbPath);
      }
    });
  }

  // Thay đổi giá trị dần dần (chỉ thay đổi một chút so với giá trị trước)
  smoothChange(currentValue, targetBase, maxChange = 0.5) {
    const diff = targetBase - currentValue;
    const change = Math.min(Math.abs(diff), maxChange) * (diff > 0 ? 1 : -1);
    const randomNoise = (Math.random() - 0.5) * 0.3; // Nhiễu nhỏ
    return parseFloat((currentValue + change + randomNoise).toFixed(2));
  }

  // Tạo dữ liệu cho 30 ngày gần nhất
  generateData(days = 30) {
    return new Promise((resolve, reject) => {
      const endDate = new Date(); // Thời điểm hiện tại
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days + 1); // Trở về 30 ngày

      console.log(`\nBắt đầu tạo dữ liệu từ ${startDate.toLocaleString('vi-VN')} đến ${endDate.toLocaleString('vi-VN')}`);
      console.log(`Tạo dữ liệu mỗi 5 phút (dữ liệu thay đổi dần dần)...\n`);

      const interval = 5 * 60 * 1000; // 5 phút
      let currentDate = new Date(startDate);
      let count = 0;
      const batchSize = 100;
      let batch = [];

      // Giá trị khởi tạo ban đầu
      let currentTemp = 28.0;
      let currentHum = 65.0;
      let currentSoil = 50.0;
      let lastWaterHour = -1;

      const insertBatch = () => {
        return new Promise((res, rej) => {
          if (batch.length === 0) {
            res();
            return;
          }

          const placeholders = batch.map(() => "(?, ?, ?, ?)").join(",");
          const sql = `INSERT INTO measurements (temp, hum, soil, timestamp) VALUES ${placeholders}`;
          const values = batch.flat();

          this.db.run(sql, values, function (err) {
            if (err) {
              rej(err);
            } else {
              res();
            }
          });
        });
      };

      const generateNext = async () => {
        while (currentDate <= endDate) {
          const hour = currentDate.getHours();
          const minute = currentDate.getMinutes();
          
          // Xác định mục tiêu cho từng thời điểm trong ngày
          let tempTarget, humTarget, soilTarget;
          
          // Nhiệt độ: thay đổi theo giờ trong ngày (thay đổi dần)
          if (hour >= 0 && hour < 6) {
            tempTarget = 24; // Đêm khuya mát
          } else if (hour >= 6 && hour < 12) {
            tempTarget = 24 + (hour - 6) * 1.5; // Tăng dần buổi sáng
          } else if (hour >= 12 && hour < 15) {
            tempTarget = 33; // Nóng nhất buổi trưa
          } else if (hour >= 15 && hour < 18) {
            tempTarget = 33 - (hour - 15) * 2; // Giảm dần chiều
          } else {
            tempTarget = 27 - (hour - 18) * 0.5; // Giảm dần tối
          }
          
          // Độ ẩm không khí: ngược với nhiệt độ
          if (hour >= 0 && hour < 6) {
            humTarget = 80; // Đêm ẩm
          } else if (hour >= 6 && hour < 12) {
            humTarget = 80 - (hour - 6) * 4; // Giảm dần buổi sáng
          } else if (hour >= 12 && hour < 15) {
            humTarget = 50; // Khô nhất buổi trưa
          } else if (hour >= 15 && hour < 18) {
            humTarget = 50 + (hour - 15) * 5; // Tăng dần chiều
          } else {
            humTarget = 65 + (hour - 18) * 2; // Tăng dần tối
          }
          
          // Độ ẩm đất: giảm dần, tăng khi tưới
          // Tưới vào 6h sáng và 6h chiều
          if ((hour === 6 || hour === 18) && minute === 0 && lastWaterHour !== hour) {
            currentSoil = 80; // Tưới nước
            lastWaterHour = hour;
            soilTarget = 80;
          } else {
            // Giảm dần 0.05% mỗi 5 phút (khoảng 0.6%/giờ)
            soilTarget = currentSoil - 0.05;
          }
          
          // Thay đổi dần dần so với giá trị hiện tại
          currentTemp = this.smoothChange(currentTemp, tempTarget, 0.3);
          currentHum = this.smoothChange(currentHum, humTarget, 0.5);
          
          if ((hour === 6 || hour === 18) && minute === 0 && lastWaterHour === hour) {
            currentSoil = 80; // Nhảy lên ngay khi tưới
          } else {
            currentSoil = this.smoothChange(currentSoil, soilTarget, 0.1);
          }
          
          // Đảm bảo trong giới hạn hợp lý
          currentTemp = Math.max(20, Math.min(38, currentTemp));
          currentHum = Math.max(30, Math.min(95, currentHum));
          currentSoil = Math.max(20, Math.min(85, currentSoil));

          // Định dạng timestamp theo giờ Việt Nam (UTC+7)
          const vnTime = new Date(currentDate.getTime() + (7 * 60 * 60 * 1000));
          const timestamp = vnTime.toISOString().replace("T", " ").slice(0, 19);

          batch.push([currentTemp, currentHum, currentSoil, timestamp]);
          count++;

          // Insert theo batch
          if (batch.length >= batchSize) {
            await insertBatch();
            process.stdout.write(`\rĐã tạo: ${count} bản ghi...`);
            batch = [];
          }

          // Tăng thời gian lên 5 phút
          currentDate = new Date(currentDate.getTime() + interval);
        }

        // Insert batch cuối cùng
        if (batch.length > 0) {
          await insertBatch();
          batch = [];
        }

        console.log(`\r✓ Hoàn thành! Đã tạo ${count} bản ghi dữ liệu.`);
        resolve(count);
      };

      generateNext().catch(reject);
    });
  }

  // Xóa toàn bộ dữ liệu cũ và reset ID
  clearData() {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run("DELETE FROM measurements", function (err) {
          if (err) {
            reject(err);
            return;
          }
          console.log(`✓ Đã xóa ${this.changes} bản ghi cũ`);
        });
        
        // Reset AUTO_INCREMENT
        this.db.run("DELETE FROM sqlite_sequence WHERE name='measurements'", function (err) {
          if (err && err.message.indexOf('no such table') === -1) {
            reject(err);
          } else {
            console.log("✓ Đã reset ID về 1");
            resolve();
          }
        });
      });
    });
  }

  // Đóng kết nối database
  close() {
    this.db.close((err) => {
      if (err) {
        console.error("Lỗi đóng database:", err.message);
      } else {
        console.log("✓ Đã đóng kết nối database");
      }
    });
  }

  // Thống kê dữ liệu
  getStats() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(*) as total,
          MIN(timestamp) as first_date,
          MAX(timestamp) as last_date,
          AVG(temp) as avg_temp,
          AVG(hum) as avg_hum,
          AVG(soil) as avg_soil,
          MIN(temp) as min_temp,
          MAX(temp) as max_temp,
          MIN(hum) as min_hum,
          MAX(hum) as max_hum,
          MIN(soil) as min_soil,
          MAX(soil) as max_soil
        FROM measurements
      `;
      
      this.db.get(sql, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
}

// Chạy khi gọi trực tiếp file này
if (require.main === module) {
  const generator = new DataGenerator();

  (async () => {
    try {
      console.log("=".repeat(50));
      console.log("  GENERATOR DỮ LIỆU CHO BẢNG MEASUREMENTS");
      console.log("  (Dữ liệu thay đổi dần dần - Hợp lý hơn)");
      console.log("=".repeat(50));

      // Xóa dữ liệu cũ và reset ID
      console.log("\nBước 1: Xóa dữ liệu cũ và reset ID...");
      await generator.clearData();

      // Tạo dữ liệu mới
      console.log("\nBước 2: Tạo dữ liệu mới...");
      await generator.generateData(30);

      // Hiển thị thống kê
      console.log("\nBước 3: Thống kê dữ liệu:");
      const stats = await generator.getStats();
      console.log("-".repeat(50));
      console.log(`Tổng số bản ghi: ${stats.total}`);
      console.log(`Ngày đầu tiên:   ${stats.first_date}`);
      console.log(`Ngày cuối cùng:  ${stats.last_date}`);
      console.log("");
      console.log(`Nhiệt độ:    ${parseFloat(stats.min_temp).toFixed(1)}°C - ${parseFloat(stats.max_temp).toFixed(1)}°C (TB: ${parseFloat(stats.avg_temp).toFixed(1)}°C)`);
      console.log(`Độ ẩm KK:    ${parseFloat(stats.min_hum).toFixed(1)}% - ${parseFloat(stats.max_hum).toFixed(1)}% (TB: ${parseFloat(stats.avg_hum).toFixed(1)}%)`);
      console.log(`Độ ẩm đất:   ${parseFloat(stats.min_soil).toFixed(1)}% - ${parseFloat(stats.max_soil).toFixed(1)}% (TB: ${parseFloat(stats.avg_soil).toFixed(1)}%)`);
      console.log("-".repeat(50));

      console.log("\n✓ HOÀN THÀNH! Dữ liệu đã thay đổi dần dần, hợp lý hơn.\n");
    } catch (error) {
      console.error("\n✗ LỖI:", error.message);
    } finally {
      generator.close();
    }
  })();
}

module.exports = DataGenerator;
