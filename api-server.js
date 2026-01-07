const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const mqtt = require('mqtt');

const app = express();
const PORT = 3000;

// MQTT Configuration for sending commands to ESP32
const MQTT_BROKER_URL = 'mqtt://192.168.110.34:1883';
const MQTT_CONTROL_TOPIC = 'hydro/control/chiller'; // Topic for chiller control commands

// Connect to MQTT broker for sending commands
let mqttClient = null;
let mqttConnectionAttempts = 0;
let lastErrorLogTime = 0;
const ERROR_LOG_INTERVAL = 10000; // Log errors at most once every 10 seconds

try {
  mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    keepalive: 60,
  });

  mqttClient.on('connect', () => {
    console.log('✅ API Server: Connected to MQTT broker for sending commands');
    mqttConnectionAttempts = 0; // Reset counter on successful connection
  });

  mqttClient.on('error', (err) => {
    mqttConnectionAttempts++;
    const now = Date.now();
    
    // Only log errors occasionally to avoid spam
    if (now - lastErrorLogTime > ERROR_LOG_INTERVAL) {
      if (mqttConnectionAttempts === 1) {
        console.error('❌ API Server: MQTT connection error:', err.message);
        console.log('💡 Tip: Make sure the MQTT broker is running: npm run broker');
      } else if (mqttConnectionAttempts % 6 === 0) { // Log every 30 seconds (6 attempts * 5s)
        console.warn(`⚠️  API Server: Still unable to connect to MQTT broker (attempt ${mqttConnectionAttempts})`);
        console.log('💡 Make sure the MQTT broker is running: npm run broker');
      }
      lastErrorLogTime = now;
    }
  });

  mqttClient.on('offline', () => {
    console.warn('⚠️  API Server: MQTT client went offline');
  });

  mqttClient.on('reconnect', () => {
    // Silently reconnect - don't log every attempt
  });
} catch (error) {
  console.error('⚠️  Warning: Could not initialize MQTT client:', error.message);
}

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from public folder

// ================= PostgreSQL Configuration =================
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'data_nethouse',
  user: 'postgres',
  password: 'haippuntek12',
};

const pool = new Pool(pgConfig);

// Test PostgreSQL connection and initialize system_status
pool.connect()
  .then(async (client) => {
    console.log('✅ API Server: Connected to PostgreSQL database');
    
    // Check if system_status has any records, if not create one
    try {
      const checkResult = await client.query('SELECT COUNT(*) FROM system_status');
      const count = parseInt(checkResult.rows[0].count);
      
      if (count === 0) {
        const currentDate = new Date().toISOString().split('T')[0];
        const currentTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS format
        await client.query(
          'INSERT INTO system_status (mode, record_date, record_time, chiller_status, fsm_state, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
          ['auto', currentDate, currentTime, 'OFF', 'S0']
        );
        console.log('✅ Initialized system_status with default "auto" mode');
      }
    } catch (error) {
      console.error('⚠️  Warning: Could not initialize system_status:', error.message);
    }
    
    client.release();
  })
  .catch(err => {
    console.error('❌ API Server: PostgreSQL connection error:', err);
  });

// ================= API Routes =================

// GET /api/logs - Get all system logs with pagination
app.get('/api/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) FROM system_logs');
    const total = parseInt(countResult.rows[0].count);

    // Get logs (include chiller and state if they exist)
    const query = `
      SELECT id, record_date, record_time, ldr_value, battery_voltage, temperature,
             COALESCE(chiller, '') as chiller, COALESCE(state, '') as state, created_at
      FROM system_logs
      ORDER BY created_at DESC, record_date DESC, record_time DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(query, [limit, offset]);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/logs/latest - Get latest sensor reading
app.get('/api/logs/latest', async (req, res) => {
  try {
    const query = `
      SELECT id, record_date, record_time, ldr_value, battery_voltage, temperature,
             COALESCE(chiller, '') as chiller, COALESCE(state, '') as state, created_at
      FROM system_logs
      ORDER BY created_at DESC, record_date DESC, record_time DESC
      LIMIT 1
    `;

    const result = await pool.query(query);

    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    console.error('Error fetching latest log:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/status - Get current system status
app.get('/api/status', async (req, res) => {
  try {
    const query = `
      SELECT id, mode, record_date, record_time, chiller_status, fsm_state, created_at
      FROM system_status
      ORDER BY id DESC
      LIMIT 1
    `;

    const result = await pool.query(query);

    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      // Default status if none exists
      res.json({ success: true, data: { mode: 'auto', id: null } });
    }
  } catch (error) {
    console.error('Error fetching status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/status - Update system status mode
app.post('/api/status', async (req, res) => {
  try {
    const { mode } = req.body;

    if (!mode || !['auto', 'manual'].includes(mode.toLowerCase())) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid mode. Must be "auto" or "manual"' 
      });
    }

    // Get current date and time
    const currentDate = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS format
    const modeValue = mode.toLowerCase();

    // Check if status exists
    const checkQuery = `SELECT id, record_date, record_time, chiller_status, fsm_state FROM system_status ORDER BY id DESC LIMIT 1`;
    const checkResult = await pool.query(checkQuery);

    let result;
    if (checkResult.rows.length > 0) {
      const existingId = checkResult.rows[0].id;
      const existingDate = checkResult.rows[0].record_date || currentDate;
      const existingTime = checkResult.rows[0].record_time || currentTime;
      const existingChiller = checkResult.rows[0].chiller_status || 'OFF';
      const existingState = checkResult.rows[0].fsm_state || 'S0';
      
      // Update existing - update mode and keep existing other values
      const updateQuery = `
        UPDATE system_status 
        SET mode = $1, record_date = $2, record_time = $3, chiller_status = $4, fsm_state = $5
        WHERE id = $6
        RETURNING id, mode, record_date, record_time, chiller_status, fsm_state, created_at
      `;
      result = await pool.query(updateQuery, [modeValue, existingDate, existingTime, existingChiller, existingState, existingId]);
      
      // Verify the update worked
      if (!result.rows.length) {
        throw new Error('Update failed - no rows affected');
      }
    } else {
      // Insert new
      const insertQuery = `
        INSERT INTO system_status (mode, record_date, record_time, chiller_status, fsm_state, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, mode, record_date, record_time, chiller_status, fsm_state, created_at
      `;
      result = await pool.query(insertQuery, [modeValue, currentDate, currentTime, 'OFF', 'S0']);
    }

    res.json({ 
      success: true, 
      message: `Mode updated to ${mode}`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/chiller/control - Control chiller (ON/OFF)
app.post('/api/chiller/control', async (req, res) => {
  try {
    const { action } = req.body; // 'ON' or 'OFF'

    if (!action || !['ON', 'OFF'].includes(action.toUpperCase())) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid action. Must be "ON" or "OFF"' 
      });
    }

    // Check if system is in manual mode
    const statusQuery = `SELECT mode FROM system_status ORDER BY id DESC LIMIT 1`;
    const statusResult = await pool.query(statusQuery);
    
    if (statusResult.rows.length === 0 || statusResult.rows[0].mode.toLowerCase() !== 'manual') {
      return res.status(400).json({ 
        success: false, 
        error: 'Chiller can only be controlled manually in MANUAL mode' 
      });
    }

    // Update system_status with new chiller status
    const currentDate = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(' ')[0];
    
    const updateQuery = `
      UPDATE system_status 
      SET chiller_status = $1, record_date = $2, record_time = $3
      WHERE id = (SELECT id FROM system_status ORDER BY id DESC LIMIT 1)
      RETURNING id, chiller_status;
    `;
    
    const updateResult = await pool.query(updateQuery, [action.toUpperCase(), currentDate, currentTime]);

    // Send MQTT command to ESP32 to control chiller
    if (mqttClient && mqttClient.connected) {
      // First ensure system is in MANUAL mode
      const modeCommand = 'MODE=MANUAL';
      const chillerCommand = `CHILLER=${action.toUpperCase()}`;
      
      // Publish mode command first
      mqttClient.publish(MQTT_CONTROL_TOPIC, modeCommand, { qos: 1 }, (err) => {
        if (err) {
          console.error('Error publishing mode command:', err);
        } else {
          console.log(`📤 Sent mode command to ESP32: ${modeCommand}`);
          
          // Wait a bit before sending chiller command to ensure mode is set
          setTimeout(() => {
            mqttClient.publish(MQTT_CONTROL_TOPIC, chillerCommand, { qos: 1 }, (err) => {
              if (err) {
                console.error('Error publishing chiller command:', err);
              } else {
                console.log(`📤 Sent chiller command to ESP32: ${chillerCommand}`);
                console.log(`   Topic: ${MQTT_CONTROL_TOPIC}`);
              }
            });
          }, 500); // 500ms delay to ensure MODE command is processed first
        }
      });
    } else {
      console.warn('⚠️  MQTT client not connected, command not sent');
      return res.status(503).json({ 
        success: false, 
        error: 'MQTT broker not available. Please start the broker: npm run broker' 
      });
    }
    
    res.json({ 
      success: true, 
      message: `Chiller ${action.toUpperCase()} command sent`,
      data: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Error controlling chiller:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API Server is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔌 API Endpoints:`);
  console.log(`   GET  /api/logs - Get system logs`);
  console.log(`   GET  /api/logs/latest - Get latest reading`);
  console.log(`   GET  /api/status - Get system status`);
  console.log(`   POST /api/status - Update system status`);
  console.log(`   POST /api/chiller/control - Control chiller (ON/OFF)`);
});

