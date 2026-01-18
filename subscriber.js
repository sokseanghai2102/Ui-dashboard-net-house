const mqtt = require('mqtt');
const { Pool } = require('pg');

// ================= MQTT Configuration =================
// Use your computer's IP address so ESP32 can connect
// Find your IP with: ipconfig (Windows) or ifconfig (Linux/Mac)
const brokerUrl = 'mqtt://192.168.127.51:1883';  // Change to your computer's IP address
const mqttTopic = 'hydro/data';  // Match the ESP32 topic
const mqttControlTopic = 'hydro/control';  // Control topic for mode updates

// ================= PostgreSQL Configuration =================
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'data_nethouse',
  user: 'postgres',
  password: 'haippuntek12',
};

// Create PostgreSQL connection pool
const pool = new Pool(pgConfig);

// Test PostgreSQL connection and create table if needed
pool.connect()
  .then(async (client) => {
    console.log('✅ Connected to PostgreSQL database: data_nethouse');
    client.release();
    // Auto-create table on startup
    await createTable();
  })
  .catch(err => {
    console.error('❌ PostgreSQL connection error:', err);
    process.exit(1);
  });

// ================= MQTT Client Setup =================
const client = mqtt.connect(brokerUrl, {
  reconnectPeriod: 5000,
  connectTimeout: 30000,
});

client.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  client.subscribe(mqttTopic, (err) => {
    if (err) {
      console.error('❌ Subscribe error:', err);
    } else {
      console.log(`🔔 Subscribed to topic: ${mqttTopic}`);
    }
  });
  
  // Subscribe to control topic to publish mode updates
  client.subscribe(mqttControlTopic, (err) => {
    if (!err) {
      console.log(`🔔 Subscribed to control topic: ${mqttControlTopic}`);
    }
  });
  
  // Also subscribe to all topics for debugging (optional)
  client.subscribe('/#', (err) => {
    if (!err) {
      console.log('🔔 Subscribed to all topics (debug mode)');
    }
  });
  
  // Publish initial system status
  publishSystemStatus();
});

client.on('message', async (topic, message) => {
  try {
    const messageStr = message.toString();
    console.log(`📩 [${topic}] ${messageStr}`);

    // Process data messages
    if (topic === mqttTopic) {
      await processAndStoreData(messageStr);
    }
    // Handle control topic if needed (for future use)
    else if (topic === mqttControlTopic) {
      console.log('📥 Control message received:', messageStr);
    }
  } catch (error) {
    console.error('❌ Error processing message:', error);
  }
});

// ================= Parse STM32 Data =================
function parseSTM32Data(dataString) {
  // Format: "Date:29-12-2025 Time=00:47:09 LDR=1174 VB=56.50 T=30.00 CHILLER=OFF(A) MODE=AUTO STATE=S0"
  // Use current date/time as fallback if parsing fails
  const now = new Date();
  const defaultDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const defaultTime = now.toTimeString().split(' ')[0]; // HH:MM:SS
  
  const result = {
    record_date: defaultDate, // Default to current date
    record_time: defaultTime, // Default to current time
    ldr_value: null,
    battery_voltage: null,
    temperature: null,
    chiller: null,
    state: null,
    mode: null
  };

  try {
    // Extract Date: DD-MM-YYYY
    const dateMatch = dataString.match(/Date:(\d{2}-\d{2}-\d{4})/);
    if (dateMatch) {
      const [day, month, year] = dateMatch[1].split('-');
      // Validate date components (basic validation)
      const dayNum = parseInt(day);
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);
      
      // Only use if values are reasonable (year between 2000-2100, month 1-12, day 1-31)
      if (yearNum >= 2000 && yearNum <= 2100 && monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        result.record_date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`; // Convert to YYYY-MM-DD format
      } else {
        console.warn(`⚠️  Invalid date format: ${day}-${month}-${year}, using current date: ${result.record_date}`);
      }
    }

    // Extract Time: HH:MM:SS
    const timeMatch = dataString.match(/Time=(\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const seconds = parseInt(timeMatch[3]);
      
      // Validate time components
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
        result.record_time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2].padStart(2, '0')}:${timeMatch[3].padStart(2, '0')}`;
      } else {
        console.warn(`⚠️  Invalid time format: ${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}, using current time: ${result.record_time}`);
      }
    }

    // Extract LDR value
    const ldrMatch = dataString.match(/LDR=(\d+)/);
    if (ldrMatch) {
      result.ldr_value = parseInt(ldrMatch[1]);
    }

    // Extract Battery Voltage (VB)
    const vbMatch = dataString.match(/VB=([\d.]+)/);
    if (vbMatch) {
      result.battery_voltage = parseFloat(vbMatch[1]);
    }

    // Extract Temperature (T)
    const tempMatch = dataString.match(/T=([\d.]+)/);
    if (tempMatch) {
      result.temperature = parseFloat(tempMatch[1]);
    }

    // Extract Chiller status (CHILLER=OFF or CHILLER=ON)
    const chillerMatch = dataString.match(/CHILLER=(ON|OFF)/i);
    if (chillerMatch) {
      result.chiller = chillerMatch[1].toUpperCase();
    }

    // Extract State (STATE=S0, S1, S2, etc.)
    const stateMatch = dataString.match(/STATE=([S\d]+)/i);
    if (stateMatch) {
      result.state = stateMatch[1].toUpperCase();
    }

    // Extract Mode (MODE=AUTO or MODE=MANUAL)
    const modeMatch = dataString.match(/MODE=(AUTO|MANUAL)/i);
    if (modeMatch) {
      result.mode = modeMatch[1].toUpperCase();
    }
  } catch (error) {
    console.error('Error parsing STM32 data:', error);
  }

  return result;
}

// ================= Check System Status =================
async function checkSystemStatus() {
  try {
    const query = `SELECT mode FROM system_status ORDER BY id DESC LIMIT 1`;
    const result = await pool.query(query);
    
    if (result.rows.length > 0) {
      return result.rows[0].mode.toLowerCase(); // Should be 'auto' or 'manual'
    }
    // Default to 'auto' if no status found
    return 'auto';
  } catch (error) {
    console.error('❌ Error checking system_status:', error.message);
    // Default to 'auto' on error
    return 'auto';
  }
}

// ================= Publish System Status to ESP32 =================
async function publishSystemStatus() {
  try {
    const mode = await checkSystemStatus();
    const message = JSON.stringify({ mode: mode });
    client.publish(mqttControlTopic, message, { qos: 1, retain: true });
    console.log(`📤 Published system mode to ESP32: ${mode}`);
  } catch (error) {
    console.error('❌ Error publishing system status:', error.message);
  }
}

// ================= Process and Store Data =================
async function processAndStoreData(messageStr) {
  try {
    let sensorData = '';
    
    // Try to parse as JSON first (for backward compatibility)
    try {
      const data = JSON.parse(messageStr);
      console.log('📊 Parsed JSON data:', data);
      // Extract data string from JSON
      sensorData = data.data || messageStr;
    } catch (jsonError) {
      // If not JSON, treat as raw text directly
      console.log('📊 Raw text data received');
      sensorData = messageStr;
    }

    // Parse STM32 data format
    const parsedData = parseSTM32Data(sensorData);
    
    console.log('📋 Parsed STM32 values:', parsedData);

    // Insert data into system_logs table
    // Note: If chiller and state columns don't exist, they will be ignored
    const query = `
      INSERT INTO system_logs (record_date, record_time, ldr_value, battery_voltage, temperature, chiller, state, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id;
    `;

    const result = await pool.query(query, [
      parsedData.record_date,
      parsedData.record_time,
      parsedData.ldr_value,
      parsedData.battery_voltage,
      parsedData.temperature,
      parsedData.chiller,
      parsedData.state
    ]);
    
    console.log(`✅ Data stored in system_logs (ID: ${result.rows[0].id})`);
    console.log(`   Date: ${parsedData.record_date}, Time: ${parsedData.record_time}`);
    console.log(`   LDR: ${parsedData.ldr_value}, Voltage: ${parsedData.battery_voltage}V, Temp: ${parsedData.temperature}°C`);

    // Update system_status table with current chiller status and state from STM32
    // Always update if we have chiller, state, or mode data
    if (parsedData.chiller || parsedData.state || parsedData.mode) {
      try {
        // Build dynamic update query based on what data we have
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        // Always update chiller_status if we have it
        if (parsedData.chiller) {
          updates.push(`chiller_status = $${paramIndex}`);
          values.push(parsedData.chiller);
          paramIndex++;
        }
        
        // Always update fsm_state if we have it
        if (parsedData.state) {
          updates.push(`fsm_state = $${paramIndex}`);
          values.push(parsedData.state);
          paramIndex++;
        }
        
        // Always update mode if we have it
        if (parsedData.mode) {
          updates.push(`mode = $${paramIndex}`);
          values.push(parsedData.mode.toLowerCase());
          paramIndex++;
        }
        
        // Update date and time if available
        if (parsedData.record_date) {
          updates.push(`record_date = $${paramIndex}`);
          values.push(parsedData.record_date);
          paramIndex++;
        }
        
        if (parsedData.record_time) {
          updates.push(`record_time = $${paramIndex}`);
          values.push(parsedData.record_time);
          paramIndex++;
        }
        
        if (updates.length > 0) {
          // First try to update existing record
          const updateStatusQuery = `
            UPDATE system_status 
            SET ${updates.join(', ')}
            WHERE id = (SELECT id FROM system_status ORDER BY id DESC LIMIT 1)
            RETURNING id, chiller_status, fsm_state, mode;
          `;
          
          const statusResult = await pool.query(updateStatusQuery, values);
          
          if (statusResult.rows.length > 0) {
            // Update successful
            const updated = statusResult.rows[0];
            const updateLog = [];
            if (parsedData.chiller) updateLog.push(`Chiller=${updated.chiller_status}`);
            if (parsedData.state) updateLog.push(`State=${updated.fsm_state}`);
            if (parsedData.mode) updateLog.push(`Mode=${updated.mode}`);
            console.log(`   ✅ Updated system_status: ${updateLog.join(', ')}`);
          } else {
            // No existing record, create a new one
            const currentDate = parsedData.record_date || new Date().toISOString().split('T')[0];
            const currentTime = parsedData.record_time || new Date().toTimeString().split(' ')[0];
            const insertValues = [
              parsedData.mode ? parsedData.mode.toLowerCase() : 'auto',
              currentDate,
              currentTime,
              parsedData.chiller || 'OFF',
              parsedData.state || 'S0'
            ];
            
            const insertQuery = `
              INSERT INTO system_status (mode, record_date, record_time, chiller_status, fsm_state, created_at)
              VALUES ($1, $2, $3, $4, $5, NOW())
              RETURNING id, chiller_status, fsm_state, mode;
            `;
            
            const insertResult = await pool.query(insertQuery, insertValues);
            if (insertResult.rows.length > 0) {
              const inserted = insertResult.rows[0];
              console.log(`   ✅ Created system_status: Chiller=${inserted.chiller_status}, State=${inserted.fsm_state}, Mode=${inserted.mode}`);
            }
          }
        }
      } catch (statusError) {
        console.error('⚠️  Error updating system_status:', statusError.message);
      }
    }

  } catch (error) {
    console.error('❌ Error storing data:', error.message);
    console.error('   Raw data:', messageStr);
  }
}

// ================= Create Table if Not Exists =================
async function createTable() {
  // Check if system_logs table exists, if not create it
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      record_date DATE,
      record_time TIME,
      ldr_value INTEGER,
      battery_voltage DECIMAL(5,2),
      temperature DECIMAL(5,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const indexQueries = [
    `CREATE INDEX IF NOT EXISTS idx_record_date ON system_logs(record_date);`,
    `CREATE INDEX IF NOT EXISTS idx_created_at ON system_logs(created_at);`
  ];

  try {
    await pool.query(createTableQuery);
    console.log('✅ Table system_logs ready');
    
    // Create indexes
    for (const indexQuery of indexQueries) {
      await pool.query(indexQuery);
    }
    console.log('✅ Indexes ready');
  } catch (error) {
    console.error('❌ Error setting up table:', error);
  }
}

client.on('error', (err) => {
  console.error('❌ MQTT connection error:', err);
});

// ================= Graceful Shutdown =================
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  client.end();
  await pool.end();
  console.log('✅ Disconnected from MQTT and PostgreSQL');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  client.end();
  await pool.end();
  console.log('✅ Disconnected from MQTT and PostgreSQL');
  process.exit(0);
});

console.log('🚀 MQTT to PostgreSQL service starting...');