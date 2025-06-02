//api/index.js

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
console.log("api testing")

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');

const app = express();
const redisConfig = {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxLoadTimeout: 10000,
  lazyConnect: true
};


if (process.env.REDIS_URL?.includes('rediss://')) {
  redisConfig.tls = {};
}

console.log('Connecting to Redis with URL:', process.env.REDIS_URL ? 'URL provided' : 'No URL found');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', redisConfig);


redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('ready', () => {
  console.log('✅ Redis ready to receive commands');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


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

const TIMER_KEY = 'timer_data_second';
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
    console.error('Error getting data from Redis:', error);
    
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
    console.error('Error saving data to Redis:', error);
    return false;
  }
}


app.get('/api/timer', async (req, res) => {
  try {
    console.log('Timer status request received');
    const data = await getData();
    
    
    const now = Date.now();
    let dataModified = false;
    
    if (data.scheduledTimers && data.scheduledTimers.length > 0) {
      
      for (let i = 0; i < data.scheduledTimers.length; i++) {
        const schedule = data.scheduledTimers[i];
        
        (status)
        if (schedule.status === undefined) {
          if (schedule.active === true) {
            data.scheduledTimers[i].status = 'activated';
            data.scheduledTimers[i].activatedAt = now - 5000; 
          } else {
            if (schedule.startAt <= now) {
              
              data.scheduledTimers[i].status = 'expired';
              data.scheduledTimers[i].expiredAt = now;
            } else {
              
              data.scheduledTimers[i].status = 'pending';
            }
          }
          dataModified = true;
          console.log(`Migrated schedule ${schedule.id} to new format with status: ${data.scheduledTimers[i].status}`);
        }
        
        
        if (schedule.status === 'expired' || schedule.status === 'completed') {
          continue;
        }
        
        if (schedule.status === 'pending' && schedule.startAt <= now - (24 * 60 * 60 * 1000)) {
          console.log(`Marking very old schedule ${schedule.id} as expired`);
          data.scheduledTimers[i].status = 'expired';
          data.scheduledTimers[i].expiredAt = now;
          dataModified = true;
          continue;
        }
        
        completed
        if (schedule.status === 'activated' && data.endTime && now >= data.endTime) {
          console.log(`Marking activated schedule ${schedule.id} as completed`);
          data.scheduledTimers[i].status = 'completed';
          data.scheduledTimers[i].completedAt = now;
          dataModified = true;
          continue;
        }
        
        
        
        if (schedule.status === 'pending' && schedule.startAt <= now) {
          console.log(`Activating scheduled timer ${schedule.id}`);
          
          
          if (data.endTime) {
            const oldEndTime = new Date(data.endTime).toISOString();
            console.log(`Replacing existing timer that would end at ${oldEndTime}`);
            
            
            for (let j = 0; j < data.scheduledTimers.length; j++) {
              if (i !== j && data.scheduledTimers[j].status === 'activated') {
                console.log(`Marking previously activated schedule ${data.scheduledTimers[j].id} as completed`);
                data.scheduledTimers[j].status = 'completed';
                data.scheduledTimers[j].completedAt = now;
              }
            }
          }
          
          
          const endTime = now + (schedule.duration * 60 * 60 * 1000);
          data.endTime = endTime;
          
          
          data.scheduledTimers[i].status = 'activated';
          data.scheduledTimers[i].activatedAt = now;
          dataModified = true;
        }
      }
      const originalLength = data.scheduledTimers.length;
      data.scheduledTimers = data.scheduledTimers.filter(schedule => {
        
        if (schedule.status === 'completed' && schedule.completedAt && (now - schedule.completedAt > 60000)) {
          return false; 
        }
        return true; 
      });
      
      if (data.scheduledTimers.length < originalLength) {
        console.log(`Removed ${originalLength - data.scheduledTimers.length} completed schedules`);
        dataModified = true;
      }
    }
    
    
    if (dataModified) {
      console.log('Saving modified data');
      await saveData(data);
    }
    
    
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
    
    
    if (now >= endTime) {
      console.log('Timer has ended, resetting');
      
      data.endTime = null;
      await saveData(data);
      
      return res.json({ 
        active: false,
        hours: '00',
        minutes: '00',
        seconds: '00'
      });
    }
    
    
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


app.post('/api/timer', async (req, res) => {
  try {
    console.log('Manual timer update request received:', req.body);
    const { hours, password } = req.body;
    
    
    if (password !== 'HDberkah2025') {
      console.log('Password verification failed');
      return res.status(403).json({ error: 'Password salah' });
    }
    
    
    const hoursNum = parseInt(hours);
    if (isNaN(hoursNum) || hoursNum <= 0) {
      console.log('Invalid hours value:', hours);
      return res.status(400).json({ error: 'Jam harus berupa angka positif' });
    }
    
    console.log('Calculating end time for', hoursNum, 'hours');
    
    const endTime = Date.now() + (hoursNum * 60 * 60 * 1000);
    
    
    const data = await getData();
    data.endTime = endTime;
    
    
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



app.post('/api/schedule', async (req, res) => {
  try {
    console.log('Schedule timer request received:', req.body);
    const { timestamp, startDate, startTime, duration, password, timezone } = req.body;
    
    
    if (password !== 'HDberkah2025') {
      console.log('Password verification failed');
      return res.status(403).json({ error: 'Password salah' });
    }
    
    
    if (!duration) {
      console.log('Missing required fields');
      return res.status(400).json({ error: 'Durasi harus diisi' });
    }
    
    const durationNum = parseInt(duration);
    if (isNaN(durationNum) || durationNum <= 0) {
      console.log('Invalid duration value:', duration);
      return res.status(400).json({ error: 'Durasi harus berupa angka positif' });
    }
    
    
    let startAt;
    
    if (timestamp && !isNaN(parseInt(timestamp))) {
      
      startAt = parseInt(timestamp);
      console.log(`Using client timestamp: ${startAt}`);
      console.log(`Equivalent to UTC: ${new Date(startAt).toUTCString()}`);
      console.log(`Equivalent to ISO: ${new Date(startAt).toISOString()}`);
    } 
    else if (startDate && startTime) {
      
      console.log('No timestamp provided, using date components');
      
      
      const [year, month, day] = startDate.split('-').map(Number);
      const [hours, minutes] = startTime.split(':').map(Number);
      
      
      const timezoneOffset = timezone !== undefined ? parseInt(timezone) : 0;
      
      

      const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
      const offsetMinutes = Math.abs(timezoneOffset) % 60;


      let utcHours, utcMinutes;
      
      if (timezoneOffset <= 0) {
        
        utcHours = hours - offsetHours;
        utcMinutes = minutes - offsetMinutes;
      } else {
        
        utcHours = hours + offsetHours;
        utcMinutes = minutes + offsetMinutes;
      }
      
      
      while (utcMinutes < 0) { utcMinutes += 60; utcHours -= 1; }
      while (utcMinutes >= 60) { utcMinutes -= 60; utcHours += 1; }
      
      let utcDay = day;
      let utcMonth = month - 1;
      let utcYear = year;
      
      
      while (utcHours < 0) { utcHours += 24; utcDay -= 1; }
      while (utcHours >= 24) { utcHours -= 24; utcDay += 1; }
      
      
      startAt = Date.UTC(utcYear, utcMonth, utcDay, utcHours, utcMinutes, 0, 0);
      
      console.log(`Computed UTC timestamp from components: ${startAt}`);
      console.log(`Equivalent to: ${new Date(startAt).toISOString()}`);
    }
    else {
      return res.status(400).json({ error: 'Data waktu tidak lengkap' });
    }
    
    
    if (startAt <= Date.now()) {
      return res.status(400).json({ error: 'Tanggal dan waktu harus di masa depan' });
    }
    
    
    console.log('DEBUG INFO:');
    console.log(`Input date/time: ${startDate} ${startTime}`);
    console.log(`Client timezone offset: ${timezone} minutes`);
    console.log(`Final startAt timestamp: ${startAt}`);
    console.log(`Final startAt UTC: ${new Date(startAt).toUTCString()}`);
    console.log(`Final startAt ISO: ${new Date(startAt).toISOString()}`);
    console.log(`Final startAt local server time: ${new Date(startAt).toString()}`);
    console.log(`Duration: ${durationNum} hours`);
    
    
    const data = await getData();
    
    
    if (!data.scheduledTimers) {
      data.scheduledTimers = [];
    }
    
    
    const newSchedule = {
      id: uuidv4(),
      startAt: startAt,
      
      timestamp: startAt,
      duration: durationNum,
      status: 'pending',
      createdAt: Date.now(),
      
      rawDate: startDate,
      rawTime: startTime,
      timezoneOffset: timezone
    };
    
    data.scheduledTimers.push(newSchedule);
    
    
    const saveResult = await saveData(data);
    
    if (!saveResult) {
      throw new Error('Failed to save schedule data to Redis');
    }
    
    console.log('Schedule saved successfully:', newSchedule);
    
    
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


app.get('/api/schedules', async (req, res) => {
  try {
    console.log('Fetching schedules');
    
    const data = await getData();
    
    
    const now = Date.now();
    
    
    let dataModified = false;
    if (data.scheduledTimers) {
      for (let i = 0; i < data.scheduledTimers.length; i++) {
        const schedule = data.scheduledTimers[i];
        
        
        if (schedule.status === undefined) {
          if (schedule.active === true) {
            schedule.status = 'activated';
            dataModified = true;
          } else if (schedule.startAt <= now) {
            
            if (now - schedule.startAt < 24 * 60 * 60 * 1000) {
              
              console.log(`Activating pending schedule ${schedule.id} from /api/schedules`);
              
              
              const endTime = now + (schedule.duration * 60 * 60 * 1000);
              data.endTime = endTime;
              
              schedule.status = 'activated';
              schedule.activatedAt = now;
            } else {
              
              schedule.status = 'expired';
            }
            dataModified = true;
          } else {
            schedule.status = 'pending';
            dataModified = true;
          }
        }
        
        else if (schedule.status === 'pending' && schedule.startAt <= now) {
          
          if (now - schedule.startAt < 24 * 60 * 60 * 1000) {
            console.log(`Activating pending schedule ${schedule.id} from /api/schedules`);
            
            
            if (data.endTime) {
              const oldEndTime = new Date(data.endTime).toISOString();
              console.log(`Replacing existing timer that would end at ${oldEndTime}`);
              
              
              for (let j = 0; j < data.scheduledTimers.length; j++) {
                if (i !== j && data.scheduledTimers[j].status === 'activated') {
                  console.log(`Marking previously activated schedule ${data.scheduledTimers[j].id} as completed`);
                  data.scheduledTimers[j].status = 'completed';
                  data.scheduledTimers[j].completedAt = now;
                }
              }
            }
            
            
            const endTime = now + (schedule.duration * 60 * 60 * 1000);
            data.endTime = endTime;
            
            schedule.status = 'activated';
            schedule.activatedAt = now;
            dataModified = true;
          } else {
            
            schedule.status = 'expired';
            schedule.expiredAt = now;
            dataModified = true;
            console.log(`Marking very old schedule ${schedule.id} as expired from /api/schedules`);
          }
        }
      }
    }
    
    
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


app.delete('/api/schedule/:id', async (req, res) => {
  try {
    console.log(`Delete schedule request for ID: ${req.params.id}`);
    const { password } = req.query;
    
    
    if (password !== 'HDberkah2025') {
      console.log('Password verification failed');
      return res.status(403).json({ error: 'Password salah' });
    }
    
    const scheduleId = req.params.id;
    
    
    const data = await getData();
    
    
    if (data.scheduledTimers) {
      const originalLength = data.scheduledTimers.length;
      data.scheduledTimers = data.scheduledTimers.filter(schedule => schedule.id !== scheduleId);
      
      if (data.scheduledTimers.length < originalLength) {
        
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



app.get('/health', async (req, res) => {
  try {
    
    await redis.ping();
    
    
    const redisInfo = await redis.info();
    const redisConfig = redis.options;
    
    
    const allKeys = await redis.keys('*');
    
    
    const timerData = await getData();
    
    
    const memoryInfo = await redis.info('memory');
    
    
    const serverInfo = await redis.info('server');
    
    
    const clientInfo = await redis.info('clients');
    
    
    const dbSize = await redis.dbsize();
    
    
    const keyInfo = {};
    for (const key of allKeys) {
      try {
        const type = await redis.type(key);
        const ttl = await redis.ttl(key);
        const size = await redis.memory('usage', key);
        
        keyInfo[key] = {
          type: type,
          ttl: ttl === -1 ? 'no expiry' : `${ttl} seconds`,
          memoryUsage: `${size} bytes`,
          exists: await redis.exists(key)
        };
        
        
        if (key === TIMER_KEY) {
          keyInfo[key].data = await redis.get(key);
          try {
            keyInfo[key].parsedData = JSON.parse(keyInfo[key].data);
          } catch (e) {
            keyInfo[key].parseError = e.message;
          }
        }
      } catch (keyError) {
        keyInfo[key] = { error: keyError.message };
      }
    }
    
    
    const parseRedisInfo = (infoString) => {
      const lines = infoString.split('\r\n');
      const result = {};
      let currentSection = 'general';
      
      for (const line of lines) {
        if (line.startsWith('# ')) {
          currentSection = line.substring(2).toLowerCase();
          result[currentSection] = {};
        } else if (line.includes(':')) {
          const [key, value] = line.split(':');
          if (!result[currentSection]) result[currentSection] = {};
          result[currentSection][key] = value;
        }
      }
      return result;
    };
    
    const parsedRedisInfo = parseRedisInfo(redisInfo);
    const parsedMemoryInfo = parseRedisInfo(memoryInfo);
    const parsedServerInfo = parseRedisInfo(serverInfo);
    const parsedClientInfo = parseRedisInfo(clientInfo);
    
    res.json({ 
      status: 'OK',
      timestamp: new Date().toISOString(),
      
      
      environment: {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        redisUrl: process.env.REDIS_URL ? 'configured' : 'not configured',
        redisUrlType: process.env.REDIS_URL?.includes('rediss://') ? 'secure (TLS)' : 'standard'
      },
      
      
      redis: {
        status: 'connected',
        host: redisConfig.host,
        port: redisConfig.port,
        db: redisConfig.db || 0,
        family: redisConfig.family,
        connectTimeout: redisConfig.connectTimeout,
        lazyConnect: redisConfig.lazyConnect,
        maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
        retryDelayOnFailover: redisConfig.retryDelayOnFailover,
        enableReadyCheck: redisConfig.enableReadyCheck,
        maxLoadTimeout: redisConfig.maxLoadTimeout
      },
      
      
      database: {
        totalKeys: allKeys.length,
        databaseSize: dbSize,
        timerKey: TIMER_KEY,
        allKeys: allKeys,
        keyDetails: keyInfo
      },
      
      
      applicationData: {
        timerData: timerData,
        activeTimer: timerData.endTime ? {
          endTime: timerData.endTime,
          endTimeFormatted: new Date(timerData.endTime).toISOString(),
          remainingMs: Math.max(0, timerData.endTime - Date.now()),
          isActive: timerData.endTime > Date.now()
        } : null,
        scheduledTimers: {
          total: timerData.scheduledTimers?.length || 0,
          pending: timerData.scheduledTimers?.filter(s => s.status === 'pending').length || 0,
          activated: timerData.scheduledTimers?.filter(s => s.status === 'activated').length || 0,
          completed: timerData.scheduledTimers?.filter(s => s.status === 'completed').length || 0,
          expired: timerData.scheduledTimers?.filter(s => s.status === 'expired').length || 0,
          details: timerData.scheduledTimers || []
        }
      },
      
      
      serverInfo: {
        version: parsedServerInfo.server?.redis_version,
        mode: parsedServerInfo.server?.redis_mode,
        os: parsedServerInfo.server?.os,
        arch: parsedServerInfo.server?.arch_bits,
        multiplexingApi: parsedServerInfo.server?.multiplexing_api,
        uptime: parsedServerInfo.server?.uptime_in_seconds,
        uptimeHuman: parsedServerInfo.server?.uptime_in_days
      },
      
      
      memoryInfo: {
        usedMemory: parsedMemoryInfo.memory?.used_memory,
        usedMemoryHuman: parsedMemoryInfo.memory?.used_memory_human,
        usedMemoryPeak: parsedMemoryInfo.memory?.used_memory_peak,
        usedMemoryPeakHuman: parsedMemoryInfo.memory?.used_memory_peak_human,
        totalSystemMemory: parsedMemoryInfo.memory?.total_system_memory,
        totalSystemMemoryHuman: parsedMemoryInfo.memory?.total_system_memory_human,
        maxMemory: parsedMemoryInfo.memory?.maxmemory,
        maxMemoryHuman: parsedMemoryInfo.memory?.maxmemory_human
      },
      
      
      clientInfo: {
        connectedClients: parsedClientInfo.clients?.connected_clients,
        clientRecentMaxInputBuffer: parsedClientInfo.clients?.client_recent_max_input_buffer,
        clientRecentMaxOutputBuffer: parsedClientInfo.clients?.client_recent_max_output_buffer
      },
      
      
      rawRedisInfo: {
        full: parsedRedisInfo,
        memory: parsedMemoryInfo,
        server: parsedServerInfo,
        clients: parsedClientInfo
      }
    });
    
  } catch (error) {
    console.error('Health check failed:', error);
    
    
    res.status(500).json({ 
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      
      environment: {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        redisUrl: process.env.REDIS_URL ? 'configured' : 'not configured'
      },
      
      redis: {
        status: 'disconnected',
        error: error.message
      },
      
      database: {
        status: 'unavailable',
        timerKey: TIMER_KEY
      }
    });
  }
});


if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
  });
}


module.exports = app;
//end of api/index.js