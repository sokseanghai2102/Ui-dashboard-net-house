# STM32 Monitoring Dashboard & API

Complete dashboard and API server for monitoring STM32 sensor data.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

Make sure your PostgreSQL database has the required tables:

```sql
-- system_logs table (should already exist)
-- Add chiller and state columns if they don't exist:
ALTER TABLE system_logs 
ADD COLUMN IF NOT EXISTS chiller VARCHAR(10),
ADD COLUMN IF NOT EXISTS state VARCHAR(10);

-- system_status table (should already exist)
-- If not, create it:
CREATE TABLE IF NOT EXISTS system_status (
    id SERIAL PRIMARY KEY,
    mode VARCHAR(10) NOT NULL DEFAULT 'auto',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. Running the Services

You need **THREE terminals** running:

**Terminal 1 - MQTT Broker:**
```bash
npm run broker
```

**Terminal 2 - MQTT Subscriber (stores data in database):**
```bash
npm start
```

**Terminal 3 - API Server & Dashboard:**
```bash
npm run api
```

Then open your browser to: **http://localhost:3000**

## API Endpoints

### GET /api/logs
Get system logs with pagination.

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50)

**Example:**
```
GET /api/logs?page=1&limit=50
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "record_date": "2025-12-29",
      "record_time": "00:47:09",
      "ldr_value": 1174,
      "battery_voltage": 56.50,
      "temperature": 30.00,
      "chiller": "OFF",
      "state": "S0",
      "created_at": "2025-12-29T00:47:09.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "totalPages": 2
  }
}
```

### GET /api/logs/latest
Get the latest sensor reading.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "record_date": "2025-12-29",
    "record_time": "00:47:09",
    "ldr_value": 1174,
    "battery_voltage": 56.50,
    "temperature": 30.00,
    "chiller": "OFF",
    "state": "S0"
  }
}
```

### GET /api/status
Get current system status (auto/manual mode).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "mode": "auto",
    "updated_at": "2025-12-29T00:47:09.000Z"
  }
}
```

### POST /api/status
Update system status mode.

**Request Body:**
```json
{
  "mode": "auto"
}
```
or
```json
{
  "mode": "manual"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Mode updated to auto",
  "data": {
    "id": 1,
    "mode": "auto",
    "updated_at": "2025-12-29T00:47:09.000Z"
  }
}
```

## Dashboard Features

- **Real-time Updates**: Auto-refreshes every 5 seconds
- **Mode Control**: Toggle between Auto and Manual mode
- **Current Readings**: Display latest sensor values
- **History Table**: View all historical sensor data
- **Responsive Design**: Works on desktop and mobile

## File Structure

```
MQTT/
├── api-server.js      # Express API server
├── subscriber.js      # MQTT subscriber (stores data)
├── broker.js          # MQTT broker
├── public/
│   ├── index.html    # Dashboard HTML
│   ├── style.css     # Dashboard styles
│   └── script.js     # Dashboard JavaScript
└── package.json
```

