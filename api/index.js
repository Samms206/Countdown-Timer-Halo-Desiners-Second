//api/index.js
// Load environment variables for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');

const app = express();

// Inisialisasi Redis client dengan URL dari variabel lingkungan
// Enhanced Redis configuration for Vercel + Upstash
const redisConfig = {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxLoadTimeout: 10000,
  lazyConnect: true
};

// Add TLS config untuk Upstash
if (process.env.REDIS_URL?.includes('rediss://')) {
  redisConfig.tls = {};
}

console.log('Connecting to Redis with URL:', process.env.REDIS_URL ? 'URL provided' : 'No URL found');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', redisConfig);

// Enhanced Redis event listeners
redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('ready', () => {
  console.log('✅ Redis ready to receive commands');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});
// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// CORS middleware
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Kunci Redis
const TIMER_KEY = 'timer_data_second';

// Fungsi helper untuk mendapatkan data
async function getData() {
  try {
    // Coba mendapatkan data dari Redis
    const dataStr = await redis.get(TIMER_KEY);
    
    // Jika data tidak ada, inisialisasi dengan nilai default
    if (!dataStr) {
      const defaultData = { 
        endTime: null,
        scheduledTimers: []
      };
      
      await redis.set(TIMER_KEY, JSON.stringify(defaultData));
      return defaultData;
    }
    
    return JSON.parse(dataStr);
  } catch (error) {
    console.error('Error getting data from Redis:', error);
    // Kembalikan data default jika terjadi error
    return { 
      endTime: null,
      scheduledTimers: []
    };
  }
}

// Fungsi helper untuk menyimpan data
async function saveData(data) {
  try {
    await redis.set(TIMER_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Error saving data to Redis:', error);
    return false;
  }
}

// Mendapatkan status timer saat ini
app.get('/api/timer', async (req, res) => {
  try {
    console.log('Timer status request received');
    const data = await getData();
    
    // Check for scheduled timers that need to be activated
    const now = Date.now();
    let dataModified = false;
    
    if (data.scheduledTimers && data.scheduledTimers.length > 0) {
      // Process each scheduled timer
      for (let i = 0; i < data.scheduledTimers.length; i++) {
        const schedule = data.scheduledTimers[i];
        
        // Migrasi data - Konversi dari format lama (active) ke format baru (status)
        if (schedule.status === undefined) {
          if (schedule.active === true) {
            data.scheduledTimers[i].status = 'activated';
            data.scheduledTimers[i].activatedAt = now - 5000; // Anggap diaktifkan beberapa detik yang lalu
          } else {
            if (schedule.startAt <= now) {
              // Jadwal yang sudah lewat waktunya
              data.scheduledTimers[i].status = 'expired';
              data.scheduledTimers[i].expiredAt = now;
            } else {
              // Jadwal yang belum waktunya
              data.scheduledTimers[i].status = 'pending';
            }
          }
          dataModified = true;
          console.log(`Migrated schedule ${schedule.id} to new format with status: ${data.scheduledTimers[i].status}`);
        }
        
        // Skip jadwal yang sudah expired atau completed
        if (schedule.status === 'expired' || schedule.status === 'completed') {
          continue;
        }
        
        // PERBAIKAN: Jadwal yang waktunya sudah lewat tanpa pernah diaktifkan
        // Hanya ditandai expired jika sudah lewat 24 jam, bukan jika ada timer aktif
        if (schedule.status === 'pending' && schedule.startAt <= now - (24 * 60 * 60 * 1000)) {
          console.log(`Marking very old schedule ${schedule.id} as expired`);
          data.scheduledTimers[i].status = 'expired';
          data.scheduledTimers[i].expiredAt = now;
          dataModified = true;
          continue;
        }
        
        // Jika timer aktif sudah berakhir, tandai jadwal yang aktif sebagai completed
        if (schedule.status === 'activated' && data.endTime && now >= data.endTime) {
          console.log(`Marking activated schedule ${schedule.id} as completed`);
          data.scheduledTimers[i].status = 'completed';
          data.scheduledTimers[i].completedAt = now;
          dataModified = true;
          continue;
        }
        
        // PERBAIKAN: Jika jadwal perlu diaktifkan sekarang
        // Aktifkan jadwal baru dan nonaktifkan timer yang lama jika ada
        if (schedule.status === 'pending' && schedule.startAt <= now) {
          console.log(`Activating scheduled timer ${schedule.id}`);
          
          // Jika sudah ada timer aktif, catat untuk logging
          if (data.endTime) {
            const oldEndTime = new Date(data.endTime).toISOString();
            console.log(`Replacing existing timer that would end at ${oldEndTime}`);
            
            // Mark any other active schedules as completed
            for (let j = 0; j < data.scheduledTimers.length; j++) {
              if (i !== j && data.scheduledTimers[j].status === 'activated') {
                console.log(`Marking previously activated schedule ${data.scheduledTimers[j].id} as completed`);
                data.scheduledTimers[j].status = 'completed';
                data.scheduledTimers[j].completedAt = now;
              }
            }
          }
          
          // Calculate end time based on duration
          const endTime = now + (schedule.duration * 60 * 60 * 1000);
          data.endTime = endTime;
          
          // Mark this schedule as activated
          data.scheduledTimers[i].status = 'activated';
          data.scheduledTimers[i].activatedAt = now;
          dataModified = true;
        }
      }
      
      // Hapus jadwal completed yang sudah lebih dari 1 menit
      const originalLength = data.scheduledTimers.length;
      data.scheduledTimers = data.scheduledTimers.filter(schedule => {
        // Hapus jadwal completed yang sudah lebih dari 1 menit
        if (schedule.status === 'completed' && schedule.completedAt && (now - schedule.completedAt > 60000)) {
          return false; // Hapus dari array
        }
        return true; // Pertahankan dalam array
      });
      
      if (data.scheduledTimers.length < originalLength) {
        console.log(`Removed ${originalLength - data.scheduledTimers.length} completed schedules`);
        dataModified = true;
      }
    }
    
    // Simpan perubahan jika ada
    if (dataModified) {
      console.log('Saving modified data');
      await saveData(data);
    }
    
    // Check if there's an active timer
    if (!data.endTime) {
      console.log('No active timer found');
      return res.json({ 
        active: false,
        hours: '00',
        minutes: '00',
        seconds: '00'
      });
    }
    
    const endTime = data.endTime;
    
    // Jika timer sudah berakhir
    if (now >= endTime) {
      console.log('Timer has ended, resetting');
      // Reset timer
      data.endTime = null;
      await saveData(data);
      
      return res.json({ 
        active: false,
        hours: '00',
        minutes: '00',
        seconds: '00'
      });
    }
    
    // Hitung sisa waktu
    const remainingTime = endTime - now;
    const hours = Math.floor(remainingTime / (1000 * 60 * 60));
    const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);
    
    console.log(`Returning active timer: ${hours}h ${minutes}m ${seconds}s`);
    return res.json({
      active: true,
      hours: hours.toString().padStart(2, '0'),
      minutes: minutes.toString().padStart(2, '0'),
      seconds: seconds.toString().padStart(2, '0'),
      totalSeconds: Math.floor(remainingTime / 1000)
    });
    
  } catch (error) {
    console.error('Error in timer status:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message, 
      stack: error.stack 
    });
  }
});

// Set timer baru secara manual
app.post('/api/timer', async (req, res) => {
  try {
    console.log('Manual timer update request received:', req.body);
    const { hours, password } = req.body;
    
    // Verifikasi password
    if (password !== 'HDberkah2025') {
      console.log('Password verification failed');
      return res.status(403).json({ error: 'Password salah' });
    }
    
    // Validasi input jam
    const hoursNum = parseInt(hours);
    if (isNaN(hoursNum) || hoursNum <= 0) {
      console.log('Invalid hours value:', hours);
      return res.status(400).json({ error: 'Jam harus berupa angka positif' });
    }
    
    console.log('Calculating end time for', hoursNum, 'hours');
    // Hitung waktu akhir
    const endTime = Date.now() + (hoursNum * 60 * 60 * 1000);
    
    // Baca data sebelum mengubah
    const data = await getData();
    data.endTime = endTime;
    
    // Simpan ke Redis
    try {
      console.log('Attempting to save data to Redis');
      const saveResult = await saveData(data);
      
      if (!saveResult) {
        throw new Error('Failed to save data to Redis');
      }
      
      console.log('Write successful, endTime:', endTime);
    } catch (redisError) {
      console.error('Redis write error details:', redisError);
      throw redisError;
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error in manual timer update:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message, 
      stack: error.stack 
    });
  }
});

// Tambahkan timer terjadwal
// Tambahkan timer terjadwal
app.post('/api/schedule', async (req, res) => {
  try {
    console.log('Schedule timer request received:', req.body);
    const { timestamp, startDate, startTime, duration, password, timezone } = req.body;
    
    // Verifikasi password
    if (password !== 'HDberkah2025') {
      console.log('Password verification failed');
      return res.status(403).json({ error: 'Password salah' });
    }
    
    // Validasi input
    if (!duration) {
      console.log('Missing required fields');
      return res.status(400).json({ error: 'Durasi harus diisi' });
    }
    
    const durationNum = parseInt(duration);
    if (isNaN(durationNum) || durationNum <= 0) {
      console.log('Invalid duration value:', duration);
      return res.status(400).json({ error: 'Durasi harus berupa angka positif' });
    }
    
    // PERBAIKAN TIMEZONE: Prioritaskan timestamp dari client
    let startAt;
    
    if (timestamp && !isNaN(parseInt(timestamp))) {
      // Gunakan timestamp yang dikirim client (SOLUSI UTAMA)
      startAt = parseInt(timestamp);
      console.log(`Using client timestamp: ${startAt}`);
      console.log(`Equivalent to UTC: ${new Date(startAt).toUTCString()}`);
      console.log(`Equivalent to ISO: ${new Date(startAt).toISOString()}`);
    } 
    else if (startDate && startTime) {
      // Fallback jika tidak ada timestamp
      console.log('No timestamp provided, using date components');
      
      // Parse tanggal dan waktu
      const [year, month, day] = startDate.split('-').map(Number);
      const [hours, minutes] = startTime.split(':').map(Number);
      
      // Mendapatkan timezone offset dari client atau gunakan default
      const timezoneOffset = timezone !== undefined ? parseInt(timezone) : 0;
      
      // Gunakan Date.UTC untuk konsistensi
      // Konversi dari waktu lokal client ke UTC dengan memperhitungkan timezone offset
      const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
      const offsetMinutes = Math.abs(timezoneOffset) % 60;
      
      // Jika timezone negatif (GMT+), kurangkan dari waktu lokal untuk mendapatkan UTC
      // Jika timezone positif (GMT-), tambahkan ke waktu lokal untuk mendapatkan UTC
      let utcHours, utcMinutes;
      
      if (timezoneOffset <= 0) {
        // Timezone GMT+ (seperti Asia)
        utcHours = hours - offsetHours;
        utcMinutes = minutes - offsetMinutes;
      } else {
        // Timezone GMT- (seperti Amerika)
        utcHours = hours + offsetHours;
        utcMinutes = minutes + offsetMinutes;
      }
      
      // Handle overflow
      while (utcMinutes < 0) { utcMinutes += 60; utcHours -= 1; }
      while (utcMinutes >= 60) { utcMinutes -= 60; utcHours += 1; }
      
      let utcDay = day;
      let utcMonth = month - 1;
      let utcYear = year;
      
      // Handle day overflow
      while (utcHours < 0) { utcHours += 24; utcDay -= 1; }
      while (utcHours >= 24) { utcHours -= 24; utcDay += 1; }
      
      // Calculate UTC timestamp
      startAt = Date.UTC(utcYear, utcMonth, utcDay, utcHours, utcMinutes, 0, 0);
      
      console.log(`Computed UTC timestamp from components: ${startAt}`);
      console.log(`Equivalent to: ${new Date(startAt).toISOString()}`);
    }
    else {
      return res.status(400).json({ error: 'Data waktu tidak lengkap' });
    }
    
    // Validasi bahwa tanggal tidak di masa lalu
    if (startAt <= Date.now()) {
      return res.status(400).json({ error: 'Tanggal dan waktu harus di masa depan' });
    }
    
    // Logging info
    console.log('DEBUG INFO:');
    console.log(`Input date/time: ${startDate} ${startTime}`);
    console.log(`Client timezone offset: ${timezone} minutes`);
    console.log(`Final startAt timestamp: ${startAt}`);
    console.log(`Final startAt UTC: ${new Date(startAt).toUTCString()}`);
    console.log(`Final startAt ISO: ${new Date(startAt).toISOString()}`);
    console.log(`Final startAt local server time: ${new Date(startAt).toString()}`);
    console.log(`Duration: ${durationNum} hours`);
    
    // Baca data yang ada
    const data = await getData();
    
    // Inisialisasi array scheduledTimers jika belum ada
    if (!data.scheduledTimers) {
      data.scheduledTimers = [];
    }
    
    // Tambahkan jadwal baru
    const newSchedule = {
      id: uuidv4(),
      startAt: startAt,
      // Simpan juga timestamp untuk kompatibilitas
      timestamp: startAt,
      duration: durationNum,
      status: 'pending',
      createdAt: Date.now(),
      // Simpan data asli untuk referensi
      rawDate: startDate,
      rawTime: startTime,
      timezoneOffset: timezone
    };
    
    data.scheduledTimers.push(newSchedule);
    
    // Simpan ke Redis
    const saveResult = await saveData(data);
    
    if (!saveResult) {
      throw new Error('Failed to save schedule data to Redis');
    }
    
    console.log('Schedule saved successfully:', newSchedule);
    
    // Tambahkan informasi tambahan ke respons
    res.json({
      success: true,
      savedTimestamp: startAt,
      savedTime: new Date(startAt).toISOString(),
      schedule: newSchedule
    });
    
  } catch (error) {
    console.error('Error in schedule creation:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message, 
      stack: error.stack 
    });
  }
});

// Mendapatkan daftar jadwal yang belum completed
app.get('/api/schedules', async (req, res) => {
  try {
    console.log('Fetching schedules');
    
    const data = await getData();
    
    // Filter jadwal yang belum completed
    const now = Date.now();
    
    // Aktifkan jadwal yang waktunya sudah lewat namun masih pending
    let dataModified = false;
    if (data.scheduledTimers) {
      for (let i = 0; i < data.scheduledTimers.length; i++) {
        const schedule = data.scheduledTimers[i];
        
        // Migrasi data - konversi dari format lama ke format baru
        if (schedule.status === undefined) {
          if (schedule.active === true) {
            schedule.status = 'activated';
            dataModified = true;
          } else if (schedule.startAt <= now) {
            // PERBAIKAN: Cek jika jadwal masih baru (kurang dari 24 jam)
            if (now - schedule.startAt < 24 * 60 * 60 * 1000) {
              // Aktifkan jadwal jika masih baru
              console.log(`Activating pending schedule ${schedule.id} from /api/schedules`);
              
              // Hitung waktu akhir
              const endTime = now + (schedule.duration * 60 * 60 * 1000);
              data.endTime = endTime;
              
              schedule.status = 'activated';
              schedule.activatedAt = now;
            } else {
              // Tandai expired jika sudah lebih dari 24 jam
              schedule.status = 'expired';
            }
            dataModified = true;
          } else {
            schedule.status = 'pending';
            dataModified = true;
          }
        }
        // PERBAIKAN: Periksa jadwal pending yang waktunya sudah lewat
        else if (schedule.status === 'pending' && schedule.startAt <= now) {
          // Hanya aktifkan jika belum lewat 24 jam
          if (now - schedule.startAt < 24 * 60 * 60 * 1000) {
            console.log(`Activating pending schedule ${schedule.id} from /api/schedules`);
            
            // Jika sudah ada timer aktif, catat untuk logging
            if (data.endTime) {
              const oldEndTime = new Date(data.endTime).toISOString();
              console.log(`Replacing existing timer that would end at ${oldEndTime}`);
              
              // Mark any other active schedules as completed
              for (let j = 0; j < data.scheduledTimers.length; j++) {
                if (i !== j && data.scheduledTimers[j].status === 'activated') {
                  console.log(`Marking previously activated schedule ${data.scheduledTimers[j].id} as completed`);
                  data.scheduledTimers[j].status = 'completed';
                  data.scheduledTimers[j].completedAt = now;
                }
              }
            }
            
            // Hitung waktu akhir
            const endTime = now + (schedule.duration * 60 * 60 * 1000);
            data.endTime = endTime;
            
            schedule.status = 'activated';
            schedule.activatedAt = now;
            dataModified = true;
          } else {
            // Tandai expired jika sudah lebih dari 24 jam
            schedule.status = 'expired';
            schedule.expiredAt = now;
            dataModified = true;
            console.log(`Marking very old schedule ${schedule.id} as expired from /api/schedules`);
          }
        }
      }
    }
    
    // Simpan perubahan jika ada
    if (dataModified) {
      console.log('Saving modified data from /api/schedules');
      await saveData(data);
    }
    
    const activeSchedules = (data.scheduledTimers || [])
      .filter(schedule => schedule.status !== 'completed')
      .sort((a, b) => a.startAt - b.startAt);
    
    console.log(`Returning ${activeSchedules.length} active schedules`);
    res.json({ schedules: activeSchedules });
    
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message, 
      stack: error.stack,
      schedules: []
    });
  }
});

// Hapus jadwal tertentu
app.delete('/api/schedule/:id', async (req, res) => {
  try {
    console.log(`Delete schedule request for ID: ${req.params.id}`);
    const { password } = req.query;
    
    // Verifikasi password
    if (password !== 'HDberkah2025') {
      console.log('Password verification failed');
      return res.status(403).json({ error: 'Password salah' });
    }
    
    const scheduleId = req.params.id;
    
    // Baca data yang ada
    const data = await getData();
    
    // Filter out the schedule to delete
    if (data.scheduledTimers) {
      const originalLength = data.scheduledTimers.length;
      data.scheduledTimers = data.scheduledTimers.filter(schedule => schedule.id !== scheduleId);
      
      if (data.scheduledTimers.length < originalLength) {
        // Simpan data yang diperbarui
        const saveResult = await saveData(data);
        
        if (!saveResult) {
          throw new Error('Failed to save updated schedule data to Redis');
        }
        
        console.log(`Schedule ${scheduleId} deleted successfully`);
        return res.json({ success: true });
      }
    }
    
    console.log(`Schedule ${scheduleId} not found`);
    return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
    
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message, 
      stack: error.stack 
    });
  }
});

// Add health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test Redis connection
    await redis.ping();
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      redis: 'connected',
      env: process.env.NODE_ENV,
      timerKey: TIMER_KEY
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      error: error.message,
      redis: 'disconnected'
    });
  }
});

// Untuk pengembangan lokal
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
  });
}

// Export untuk Vercel
module.exports = app;
//end of api/index.js