// api/index.js - Versi Simple

// Load environment variables untuk development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

console.log("=== Timer API Starting ===");

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

// Serve static files dari folder public
app.use(express.static(path.join(__dirname, '../public')));

// Debug Environment Variables
console.log("Environment Check:");
console.log("- NODE_ENV:", process.env.NODE_ENV);
console.log("- REDIS_URL:", !!process.env.REDIS_URL);
console.log("- UPSTASH_REST_URL:", !!process.env.UPSTASH_REDIS_REST_URL);
console.log("- UPSTASH_REST_TOKEN:", !!process.env.UPSTASH_REDIS_REST_TOKEN);

// Upstash REST API Client (Simple)
class SimpleRedis {
  constructor() {
    this.baseURL = process.env.UPSTASH_REDIS_REST_URL;
    this.token = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!this.baseURL || !this.token) {
      console.error("❌ Upstash credentials missing!");
      throw new Error("Redis credentials not configured");
    }
    
    console.log("✅ Redis client initialized");
  }

  async request(command) {
    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(command)
      });
      
      if (!response.ok) {
        throw new Error(`Redis error: ${response.status}`);
      }
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Redis request failed:", error.message);
      throw error;
    }
  }

  async get(key) {
    const result = await this.request(['GET', key]);
    return result.result;
  }

  async set(key, value) {
    const result = await this.request(['SET', key, value]);
    return result.result;
  }

  async ping() {
    const result = await this.request(['PING']);
    return result.result;
  }
}

// Initialize Redis
let redis;
try {
  redis = new SimpleRedis();
} catch (error) {
  console.error("Failed to initialize Redis:", error.message);
  // Mock Redis untuk fallback
  redis = {
    get: async () => null,
    set: async () => 'OK',
    ping: async () => 'PONG (mock)'
  };
}

// Constants
const TIMER_KEY = 'timer_data_second';

// Helper Functions
async function getData() {
  try {
    const dataStr = await redis.get(TIMER_KEY);
    
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
    console.error('Error getting data:', error.message);
    return { 
      endTime: null,
      scheduledTimers: []
    };
  }
}

async function saveData(data) {
  try {
    await redis.set(TIMER_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Error saving data:', error.message);
    return false;
  }
}

// === ENDPOINTS ===

// Health Check (Simple)
app.get('/health', async (req, res) => {
  try {
    const pingResult = await redis.ping();
    const data = await getData();
    
    res.json({ 
      status: 'OK',
      timestamp: new Date().toISOString(),
      redis: pingResult,
      timerActive: !!data.endTime,
      scheduledCount: data.scheduledTimers?.length || 0
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR',
      error: error.message
    });
  }
});

// Debug Endpoint (Simple)
app.get('/debug', async (req, res) => {
  try {
    const pingResult = await redis.ping();
    const data = await getData();
    
    res.json({
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hasRedisUrl: !!process.env.REDIS_URL,
        hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
        hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN
      },
      redis: {
        ping: pingResult,
        status: 'connected'
      },
      data: {
        timerActive: !!data.endTime,
        scheduledTimers: data.scheduledTimers?.length || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hasRedisUrl: !!process.env.REDIS_URL,
        hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
        hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN
      }
    });
  }
});

// Get Timer Status
app.get('/api/timer', async (req, res) => {
  try {
    const data = await getData();
    const now = Date.now();
    
    // Process scheduled timers
    if (data.scheduledTimers && data.scheduledTimers.length > 0) {
      let dataModified = false;
      
      for (let i = 0; i < data.scheduledTimers.length; i++) {
        const schedule = data.scheduledTimers[i];
        
        // Activate pending timers
        if (schedule.status === 'pending' && schedule.startAt <= now) {
          console.log(`Activating timer ${schedule.id}`);
          
          // Set new end time
          const endTime = now + (schedule.duration * 60 * 60 * 1000);
          data.endTime = endTime;
          
          // Update status
          data.scheduledTimers[i].status = 'activated';
          data.scheduledTimers[i].activatedAt = now;
          dataModified = true;
        }
        
        // Mark completed timers
        if (schedule.status === 'activated' && data.endTime && now >= data.endTime) {
          data.scheduledTimers[i].status = 'completed';
          data.scheduledTimers[i].completedAt = now;
          dataModified = true;
        }
      }
      
      // Save changes
      if (dataModified) {
        await saveData(data);
      }
    }
    
    // Check if timer is active
    if (!data.endTime || now >= data.endTime) {
      // Reset if ended
      if (data.endTime && now >= data.endTime) {
        data.endTime = null;
        await saveData(data);
      }
      
      return res.json({ 
        active: false,
        hours: '00',
        minutes: '00',
        seconds: '00'
      });
    }
    
    // Calculate remaining time
    const remainingTime = data.endTime - now;
    const hours = Math.floor(remainingTime / (1000 * 60 * 60));
    const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);
    
    res.json({
      active: true,
      hours: hours.toString().padStart(2, '0'),
      minutes: minutes.toString().padStart(2, '0'),
      seconds: seconds.toString().padStart(2, '0'),
      totalSeconds: Math.floor(remainingTime / 1000)
    });
    
  } catch (error) {
    console.error('Timer error:', error.message);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message
    });
  }
});

// Set Manual Timer
app.post('/api/timer', async (req, res) => {
  try {
    const { hours, password } = req.body;
    
    // Verify password
    if (password !== 'HDberkah2025') {
      return res.status(403).json({ error: 'Password salah' });
    }
    
    // Validate hours
    const hoursNum = parseInt(hours);
    if (isNaN(hoursNum) || hoursNum <= 0) {
      return res.status(400).json({ error: 'Jam harus berupa angka positif' });
    }
    
    // Calculate end time
    const endTime = Date.now() + (hoursNum * 60 * 60 * 1000);
    
    // Save data
    const data = await getData();
    data.endTime = endTime;
    
    const saveResult = await saveData(data);
    if (!saveResult) {
      throw new Error('Failed to save timer data');
    }
    
    console.log(`Timer set for ${hoursNum} hours`);
    res.json({ success: true });
    
  } catch (error) {
    console.error('Set timer error:', error.message);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message
    });
  }
});

// Schedule Timer
app.post('/api/schedule', async (req, res) => {
  try {
    const { timestamp, duration, password } = req.body;
    
    // Verify password
    if (password !== 'HDberkah2025') {
      return res.status(403).json({ error: 'Password salah' });
    }
    
    // Validate input
    if (!duration || !timestamp) {
      return res.status(400).json({ error: 'Durasi dan waktu harus diisi' });
    }
    
    const durationNum = parseInt(duration);
    const startAt = parseInt(timestamp);
    
    if (isNaN(durationNum) || durationNum <= 0) {
      return res.status(400).json({ error: 'Durasi harus berupa angka positif' });
    }
    
    if (startAt <= Date.now()) {
      return res.status(400).json({ error: 'Waktu harus di masa depan' });
    }
    
    // Save schedule
    const data = await getData();
    if (!data.scheduledTimers) {
      data.scheduledTimers = [];
    }
    
    const newSchedule = {
      id: uuidv4(),
      startAt: startAt,
      duration: durationNum,
      status: 'pending',
      createdAt: Date.now()
    };
    
    data.scheduledTimers.push(newSchedule);
    
    const saveResult = await saveData(data);
    if (!saveResult) {
      throw new Error('Failed to save schedule');
    }
    
    console.log('Schedule created:', newSchedule.id);
    res.json({
      success: true,
      schedule: newSchedule
    });
    
  } catch (error) {
    console.error('Schedule error:', error.message);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message
    });
  }
});

// Get Schedules
app.get('/api/schedules', async (req, res) => {
  try {
    const data = await getData();
    
    const activeSchedules = (data.scheduledTimers || [])
      .filter(schedule => schedule.status !== 'completed')
      .sort((a, b) => a.startAt - b.startAt);
    
    res.json({ schedules: activeSchedules });
    
  } catch (error) {
    console.error('Get schedules error:', error.message);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message,
      schedules: []
    });
  }
});

// Delete Schedule
app.delete('/api/schedule/:id', async (req, res) => {
  try {
    const { password } = req.query;
    const scheduleId = req.params.id;
    
    // Verify password
    if (password !== 'HDberkah2025') {
      return res.status(403).json({ error: 'Password salah' });
    }
    
    // Delete schedule
    const data = await getData();
    
    if (data.scheduledTimers) {
      const originalLength = data.scheduledTimers.length;
      data.scheduledTimers = data.scheduledTimers.filter(schedule => schedule.id !== scheduleId);
      
      if (data.scheduledTimers.length < originalLength) {
        const saveResult = await saveData(data);
        if (!saveResult) {
          throw new Error('Failed to save updated data');
        }
        
        console.log(`Schedule ${scheduleId} deleted`);
        return res.json({ success: true });
      }
    }
    
    res.status(404).json({ error: 'Jadwal tidak ditemukan' });
    
  } catch (error) {
    console.error('Delete schedule error:', error.message);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Timer API Server',
    status: 'Running',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /test - Basic test',
      'GET /debug - Environment check',
      'GET /health - Health check',
      'GET /api/timer - Timer status',
      'POST /api/timer - Set timer',
      'GET /api/schedules - Get schedules',
      'POST /api/schedule - Create schedule',
      'DELETE /api/schedule/:id - Delete schedule'
    ]
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'Server berjalan!',
    timestamp: new Date().toISOString(),
    status: 'OK'
  });
});

// Start server (untuk development)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export untuk Vercel
module.exports = app;