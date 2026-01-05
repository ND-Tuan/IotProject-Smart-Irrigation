const socket = io();

let tempHumChart = null;
let currentView = 'dashboard';
let currentChartPeriod = 'day';

// CHUYỂN ĐỔI VIEW
function showView(viewName) {
  currentView = viewName;
  
  // Ẩn tất cả views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });
  
  // Hiện view được chọn
  document.getElementById(`view-${viewName}`).classList.add('active');
  
  // Cập nhật menu active cho cả sidebar và bottom-nav
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Đánh dấu active cho button được click trong cả 2 navigation
  document.querySelectorAll('.sidebar .menu-item, .bottom-nav .menu-item').forEach(item => {
    const itemView = item.getAttribute('onclick')?.match(/showView\('(.+?)'\)/)?.[1];
    if (itemView === viewName) {
      item.classList.add('active');
    }
  });
  
  // Load dữ liệu nếu cần
  if (viewName === 'dashboard') {
    loadDashboardData();
  } else if (viewName === 'control') {
    loadThresholdSettings();
  } else if (viewName === 'chart') {
    loadChartData(currentChartPeriod);
  } else if (viewName === 'stats') {
    loadPumpStats(currentPeriod);
  } else if (viewName === 'history') {
    loadHistory();
  } else if (viewName === 'schedule') {
    loadSchedules();
  }
}

// HÀM TẢI DỮ LIỆU DASHBOARD
function loadDashboardData() {
  fetch("/api/current-data")
    .then((response) => response.json())
    .then((result) => {
      const data = result.data;
      if (data.temp !== null) {
        document.getElementById("temp-val").innerText = data.temp;
      }
      if (data.hum !== null) {
        document.getElementById("hum-val").innerText = data.hum;
      }
      if (data.soil !== null) {
        document.getElementById("soil-val").innerText = data.soil;
      }
      // Cập nhật trạng thái bơm
      if (data.pump !== null && data.pump !== undefined) {
        const el = document.getElementById("pump-val");
        if (data.pump === "ON") {
          el.innerText = "ĐANG CHẠY";
          el.style.color = "#2e7d32";
        } else if (data.pump === "OFF") {
          el.innerText = "ĐÃ TẮT";
          el.style.color = "#c62828";
        } else {
          el.innerText = "Chưa có dữ liệu";
          el.style.color = "#666";
        }
      }
      // Cập nhật mode nếu có
      if (data.mode) {
        updateModeUI(data.mode);
      }
    })
    .catch((error) => console.error("Lỗi tải dữ liệu dashboard:", error));
  
  // Load threshold settings
  loadThresholdSettings();
}

// 1. KẾT NỐI SERVER
socket.on("connect", () => {
  console.log('✅ Socket.IO đã kết nối với server!');
  document.getElementById("connection-status").innerText =
    "Đã kết nối Server Node.js!";
  document.getElementById("connection-status").style.color = "#4caf50";
  loadChartData(currentChartPeriod);
});

socket.on("disconnect", () => {
  console.log('❌ Socket.IO bị ngắt kết nối!');
  document.getElementById("connection-status").innerText =
    "Mất kết nối Server!";
  document.getElementById("connection-status").style.color = "#f44336";
});

socket.on("connect_error", (error) => {
  console.error('❌ Lỗi kết nối Socket.IO:', error);
  document.getElementById("connection-status").innerText =
    "Lỗi kết nối Server!";
  document.getElementById("connection-status").style.color = "#f44336";
});

// 2. NHẬN DỮ LIỆU TỪ SERVER (Xử lý tất cả trong 1 hàm duy nhất)
socket.on("mqtt-message", (data) => {
  const topic = data.topic;
  const payload = data.payload;
  
  console.log(`📥 Nhận MQTT: [${topic}] = ${payload}`);

  // Cập nhật số liệu hiển thị tức thì
  if (topic === "iot/soil")
    document.getElementById("soil-val").innerText = payload;
  else if (topic === "iot/temp")
    document.getElementById("temp-val").innerText = payload;
  else if (topic === "iot/hum")
    document.getElementById("hum-val").innerText = payload;
  else if (topic === "iot/pump") {
    const el = document.getElementById("pump-val");
    if (payload === "ON") {
      el.innerText = "ĐANG CHẠY";
      el.style.color = "#2e7d32";
    } else {
      el.innerText = "ĐÃ TẮT";
      el.style.color = "#c62828";
    }
  } else if (topic === "iot/mode") updateModeUI(payload);

  // Nhận thông tin ngưỡng từ ESP32
  else if (topic === "iot/threshold") {
    const parts = payload.split(',');
    if (parts.length === 2) {
      const start = parts[0];
      const stop = parts[1];
      document.getElementById('threshold-start').value = start;
      document.getElementById('threshold-stop').value = stop;
      document.getElementById('current-threshold').innerText = `${start}-${stop}%`;
    }
  }

  // Cập nhật bảng lịch sử khi có thay đổi bơm
  if (topic === "iot/pump") {
    loadHistory();
  }
});

// 3. HÀM TẢI LỊCH SỬ BƠM
function loadHistory() {
  fetch("/api/pump-history")
    .then((response) => response.json())
    .then((data) => {
      const rows = data.data;
      
      // Update cả 2 bảng (mobile + desktop)
      const tableBodyMobile = document.getElementById("history-table-body");
      const tableBodyDesktop = document.getElementById("history-table-body-desktop");
      
      const htmlContent = rows.map((row) => {
        const action = row.action === 'ON' ? 'BẬT' : 'TẮT';
        const actionColor = row.action === 'ON' ? '#2e7d32' : '#c62828';
        const mode = row.mode === 'AUTO' ? 'Tự động' : 'Thủ công';
        const modeColor = row.mode === 'AUTO' ? '#0277bd' : '#f57c00';
        
        const date = new Date(row.timestamp);
        const timeStr = date.toLocaleString('vi-VN', { 
          day: '2-digit', 
          month: '2-digit', 
          hour: '2-digit', 
          minute: '2-digit' 
        });

        return `
          <tr>
            <td style="color: #666;">${timeStr}</td>
            <td style="font-weight: bold; color: ${actionColor};">${action}</td>
            <td style="color: ${modeColor}; font-weight: 600;">${mode}</td>
          </tr>
        `;
      }).join('');
      
      if (tableBodyMobile) tableBodyMobile.innerHTML = htmlContent;
      if (tableBodyDesktop) tableBodyDesktop.innerHTML = htmlContent;
    })
    .catch((error) => console.error("Lỗi tải lịch sử:", error));
}

// 4. GỬI LỆNH ĐIỀU KHIỂN
function updateModeUI(mode) {
  const btnAuto = document.getElementById("btn-auto");
  const btnManual = document.getElementById("btn-manual");
  const manualControls = document.getElementById("manual-controls");

  if (mode === "AUTO") {
    btnAuto.className = "btn-mode active";
    btnManual.className = "btn-mode inactive";
    manualControls.style.display = "none";
  } else {
    btnAuto.className = "btn-mode inactive";
    btnManual.className = "btn-mode active";
    manualControls.style.display = "grid";
  }
}

function setMode(mode) {
  if (!socket.connected) {
    alert('❌ Chưa kết nối server! Vui lòng kiểm tra kết nối.');
    console.error('Socket.IO chưa kết nối!');
    return;
  }
  
  console.log(`📤 Gửi lệnh chuyển mode: ${mode}`);
  socket.emit("control-command", { topic: "iot/cmd/mode", message: mode });
  
  // Cập nhật UI ngay lập tức
  updateModeUI(mode);
  
  // Hiển thị toast notification
  const statusEl = document.getElementById('connection-status');
  const originalText = statusEl.innerText;
  statusEl.innerText = `⏳ Đang chuyển sang ${mode === 'AUTO' ? 'Tự động' : 'Thủ công'}...`;
  statusEl.style.color = '#ff9800';
  
  setTimeout(() => {
    statusEl.innerText = originalText;
    statusEl.style.color = '#4caf50';
  }, 2000);
}

// Biến chống spam click
let pumpControlTimeout = null;

function controlPump(action) {
  // Kiểm tra kết nối
  if (!socket.connected) {
    alert('❌ Chưa kết nối server! Vui lòng kiểm tra kết nối.');
    console.error('Socket.IO chưa kết nối!');
    return;
  }
  
  // Chống spam - chỉ cho phép 1 lệnh trong 800ms
  if (pumpControlTimeout) {
    console.log('⚠️ Vui lòng đợi...');
    return;
  }
  
  console.log(`📤 Gửi lệnh điều khiển bơm: ${action}`);
  
  // Gửi lệnh ngay lập tức
  socket.emit("control-command", { topic: "iot/cmd/pump", message: action });
  
  // Log confirmation
  console.log(`✅ Đã gửi lệnh ${action} lên server`);
  
  // Visual feedback - thêm hiệu ứng cho nút được nhấn
  const clickedBtn = event.target.closest('.btn-pump');
  if (clickedBtn) {
    clickedBtn.style.transform = 'scale(0.95)';
    clickedBtn.style.opacity = '0.7';
    
    setTimeout(() => {
      clickedBtn.style.transform = '';
      clickedBtn.style.opacity = '';
    }, 200);
  }
  
  // Hiển thị trạng thái đang xử lý
  const pumpVal = document.getElementById('pump-val');
  if (pumpVal) {
    const isOn = action === 'ON';
    pumpVal.innerText = isOn ? '⏳ Đang bật...' : '⏳ Đang tắt...';
    pumpVal.style.color = '#ff9800';
  }
  
  // Khóa nút trong 800ms
  pumpControlTimeout = setTimeout(() => {
    pumpControlTimeout = null;
  }, 800);
}

function updateThreshold() {
  const start = document.getElementById('threshold-start').value;
  const stop = document.getElementById('threshold-stop').value;
  
  if (parseInt(stop) <= parseInt(start)) {
    alert('Ngưỡng tắt phải lớn hơn ngưỡng bật!');
    return;
  }
  
  // Gửi lên server qua API
  fetch('/api/threshold', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ start: parseInt(start), stop: parseInt(stop) })
  })
  .then(response => response.json())
  .then(result => {
    if (result.message === 'success') {
      // Cập nhật hiển thị
      document.getElementById('current-threshold').innerText = `${start}-${stop}%`;
      
      const statusEl = document.querySelector('.threshold-status small');
      const originalText = statusEl.innerHTML;
      statusEl.innerHTML = '✓ Đã cập nhật thành công!';
      statusEl.style.color = '#2e7d32';
      
      setTimeout(() => {
        statusEl.innerHTML = originalText;
        statusEl.style.color = '';
      }, 3000);
      
      console.log('Đã cập nhật ngưỡng:', result.data);
    } else {
      alert('Lỗi cập nhật: ' + result.error);
    }
  })
  .catch(error => {
    console.error('Lỗi cập nhật threshold:', error);
    alert('Không thể cập nhật ngưỡng!');
  });
}

// Load threshold từ server khi khởi động
function loadThresholdSettings() {
  fetch('/api/threshold')
    .then(response => response.json())
    .then(result => {
      if (result.message === 'success') {
        const { start, stop } = result.data;
        document.getElementById('threshold-start').value = start;
        document.getElementById('threshold-stop').value = stop;
        document.getElementById('current-threshold').innerText = `${start}-${stop}%`;
        console.log('Đã load ngưỡng:', result.data);
      }
    })
    .catch(error => console.error('Lỗi load threshold:', error));
}

// Quản lý lịch tưới
let selectedDays = [];
let editingScheduleId = null;
let editSelectedDays = [];

// Xử lý chọn ngày trong form thêm mới
document.addEventListener('DOMContentLoaded', function() {
  // Load dữ liệu dashboard ngay khi trang load
  loadDashboardData();
  
  // Cập nhật dashboard liên tục mỗi 3 giây
  setInterval(() => {
    if (currentView === 'dashboard') {
      loadDashboardData();
    }
  }, 3000);
  
  // Xử lý chọn ngày trong modal thêm mới
  const addDayButtons = document.querySelectorAll('.add-day-btn');
  addDayButtons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const day = parseInt(this.dataset.day);
      
      if (selectedDays.includes(day)) {
        selectedDays = selectedDays.filter(d => d !== day);
        this.classList.remove('active');
      } else {
        selectedDays.push(day);
        this.classList.add('active');
      }
    });
  });

  // Xử lý chọn ngày trong modal edit
  const modalDayButtons = document.querySelectorAll('.modal-day-btn:not(.add-day-btn)');
  modalDayButtons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const day = parseInt(this.dataset.day);
      
      if (editSelectedDays.includes(day)) {
        editSelectedDays = editSelectedDays.filter(d => d !== day);
        this.classList.remove('active');
      } else {
        editSelectedDays.push(day);
        this.classList.add('active');
      }
    });
  });

  // Đóng modal khi click bên ngoài
  const editModal = document.getElementById('edit-schedule-modal');
  editModal.addEventListener('click', function(e) {
    if (e.target === editModal) {
      closeEditModal();
    }
  });

  const addModal = document.getElementById('add-schedule-modal');
  addModal.addEventListener('click', function(e) {
    if (e.target === addModal) {
      closeAddModal();
    }
  });
});

function loadSchedules() {
  fetch('/api/schedules')
    .then(response => response.json())
    .then(data => {
      const scheduleList = document.getElementById('schedule-list');
      const schedules = data.data;
      
      if (schedules.length === 0) {
        scheduleList.innerHTML = '<p style="color: #666; font-style: italic;">Chưa có lịch tưới nào</p>';
        return;
      }
      
      scheduleList.innerHTML = '';
      schedules.forEach(schedule => {
        // Parse days từ JSON
        let days = [];
        try {
          days = JSON.parse(schedule.days || '[]');
        } catch (e) {
          days = [];
        }
        
        // Tạo HTML cho các ngày
        const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        const daysHtml = dayLabels.map((label, index) => {
          const isActive = days.includes(index);
          return `<span class="schedule-day ${isActive ? 'active' : ''}">${label}</span>`;
        }).join('');
        
        const item = document.createElement('div');
        item.className = 'schedule-item';
        item.onclick = () => openEditModal(schedule);
        item.innerHTML = `
          <div class="schedule-header">
            <div class="schedule-time-icon">
              <i class="fa-solid fa-clock"></i>
              <span class="schedule-time">${schedule.time}</span>
            </div>
            <label class="schedule-toggle" onclick="event.stopPropagation()">
              <input type="checkbox" ${schedule.enabled ? 'checked' : ''} 
                     onchange="toggleSchedule(${schedule.id}, this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="schedule-days">
            ${daysHtml}
          </div>
        `;
        scheduleList.appendChild(item);
      });
    })
    .catch(error => console.error('Lỗi tải lịch:', error));
}

function openAddModal() {
  // Reset form
  document.getElementById('add-schedule-time').value = '';
  selectedDays = [];
  
  // Reset tất cả nút ngày
  document.querySelectorAll('.add-day-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show modal
  document.getElementById('add-schedule-modal').classList.add('active');
}

function closeAddModal() {
  document.getElementById('add-schedule-modal').classList.remove('active');
  selectedDays = [];
}

function saveNewSchedule() {
  const time = document.getElementById('add-schedule-time').value;
  
  if (!time) {
    alert('Vui lòng chọn thời gian!');
    return;
  }
  
  if (selectedDays.length === 0) {
    alert('Vui lòng chọn ít nhất một ngày trong tuần!');
    return;
  }
  
  const duration = 60;
  
  fetch('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ time, days: selectedDays, duration })
  })
    .then(response => response.json())
    .then(() => {
      closeAddModal();
      loadSchedules();
    })
    .catch(error => console.error('Lỗi thêm lịch:', error));
}

function openEditModal(schedule) {
  editingScheduleId = schedule.id;
  
  // Parse days
  try {
    editSelectedDays = JSON.parse(schedule.days || '[]');
  } catch (e) {
    editSelectedDays = [];
  }
  
  // Set time
  document.getElementById('edit-schedule-time').value = schedule.time;
  
  // Set enabled
  document.getElementById('edit-schedule-enabled').checked = schedule.enabled === 1;
  
  // Set days
  document.querySelectorAll('.modal-day-btn').forEach(btn => {
    const day = parseInt(btn.dataset.day);
    if (editSelectedDays.includes(day)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Show modal
  document.getElementById('edit-schedule-modal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('edit-schedule-modal').classList.remove('active');
  editingScheduleId = null;
  editSelectedDays = [];
}

function saveScheduleEdit() {
  const time = document.getElementById('edit-schedule-time').value;
  const enabled = document.getElementById('edit-schedule-enabled').checked ? 1 : 0;
  
  if (!time) {
    alert('Vui lòng chọn thời gian!');
    return;
  }
  
  if (editSelectedDays.length === 0) {
    alert('Vui lòng chọn ít nhất một ngày trong tuần!');
    return;
  }
  
  const duration = 60;
  
  fetch(`/api/schedules/${editingScheduleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ time, days: editSelectedDays, duration, enabled })
  })
    .then(response => response.json())
    .then(() => {
      closeEditModal();
      loadSchedules();
    })
    .catch(error => console.error('Lỗi cập nhật lịch:', error));
}

function deleteScheduleFromModal() {
  if (!confirm('Xóa lịch tưới này?')) return;
  
  fetch(`/api/schedules/${editingScheduleId}`, { method: 'DELETE' })
    .then(() => {
      closeEditModal();
      loadSchedules();
    })
    .catch(error => console.error('Lỗi xóa lịch:', error));
}

function toggleSchedule(id, enabled) {
  fetch(`/api/schedules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: enabled ? 1 : 0 })
  })
    .catch(error => console.error('Lỗi cập nhật lịch:', error));
}

// Tải thống kê bơm
let currentPeriod = 'day';

function loadPumpStats(period) {
  currentPeriod = period;
  
  document.querySelectorAll('.btn-period').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`btn-${period}`).classList.add('active');
  
  fetch(`/api/pump-stats?period=${period}`)
    .then(response => response.json())
    .then(data => {
      const stats = data.data;
      document.getElementById('stat-total').innerText = stats.total_switches || 0;
      document.getElementById('stat-on').innerText = stats.on_count || 0;
      document.getElementById('stat-off').innerText = stats.off_count || 0;
      document.getElementById('stat-auto').innerText = stats.auto_count || 0;
      document.getElementById('stat-manual').innerText = stats.manual_count || 0;
    })
    .catch(error => console.error('Lỗi tải thống kê:', error));
}

// Hàm tải dữ liệu biểu đồ
function loadChartData(period = 'day') {
  currentChartPeriod = period;
  
  // Cập nhật nút active
  document.querySelectorAll('.btn-chart-period').forEach(btn => {
    btn.classList.remove('active');
  });
  const btnId = `chart-btn-${period}`;
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add('active');
  
  fetch(`/api/chart-data?period=${period}`)
    .then(response => response.json())
    .then(data => {
      const rows = data.data;
      
      // Tạo label thời gian và giá trị từ dữ liệu đã gộp
      const labels = rows.map(r => {
        const date = new Date(r.timestamp);
        if (period === 'month') {
          // Tháng: hiển thị theo ngày
          return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        } else if (period === 'week') {
          // Tuần: hiển thị theo giờ
          return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit' }) + 'h';
        } else {
          // Ngày: hiển thị theo phút
          return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
      });
      
      // Giá trị
      const tempValues = rows.map(r => parseFloat(r.temp));
      const humValues = rows.map(r => parseFloat(r.hum));
      const soilValues = rows.map(r => parseFloat(r.soil));
      
      // Tạo biểu đồ
      const ctx = document.getElementById('tempHumChart').getContext('2d');
      
      if (tempHumChart) {
        tempHumChart.destroy();
      }
      
      tempHumChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Nhiệt độ',
              data: tempValues,
              borderColor: '#e53935',
              backgroundColor: 'rgba(229, 57, 53, 0.1)',
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 2,
              yAxisID: 'y'
            },
            {
              label: 'Độ ẩm không khí',
              data: humValues,
              borderColor: '#039be5',
              backgroundColor: 'rgba(3, 155, 229, 0.1)',
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 2,
              yAxisID: 'y1'
            },
            {
              label: 'Độ ẩm đất',
              data: soilValues,
              borderColor: '#43a047',
              backgroundColor: 'rgba(67, 160, 71, 0.1)',
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 2,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              top: 0,
              bottom: 0,
              left: 0,
              right: 0
            }
          },
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                boxWidth: 15,
                boxHeight: 8,
                padding: 5,
                font: {
                  size: 9,
                  weight: '600'
                },
                usePointStyle: true,
                pointStyle: 'rectRounded'
              }
            }
          },
          scales: {
            x: {
              ticks: {
                font: {
                  size: 8
                },
                maxRotation: 45,
                minRotation: 45,
                padding: 2
              },
              grid: {
                display: false
              }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: {
                display: false
              },
              ticks: {
                color: '#e53935',
                font: {
                  size: 9,
                  weight: 'bold'
                },
                padding: 2
              },
              grid: {
                color: 'rgba(0, 0, 0, 0.05)'
              }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              min: 0,
              title: {
                display: false
              },
              ticks: {
                color: '#039be5',
                font: {
                  size: 9,
                  weight: 'bold'
                },
                padding: 2
              },
              grid: {
                drawOnChartArea: false
              }
            }
          }
        }
      });
    })
    .catch(error => console.error('Lỗi tải dữ liệu biểu đồ:', error));
}

// Cập nhật biểu đồ mỗi 5 phút
setInterval(loadChartData, 300000);

// Tải dữ liệu lần đầu khi mở web
loadDashboardData();
loadHistory();
loadChartData();
loadSchedules();
loadPumpStats('day');
