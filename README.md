# MQTT to PostgreSQL Service

This service subscribes to MQTT messages from the ESP32 and stores them in a PostgreSQL database.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup PostgreSQL Database

Make sure PostgreSQL is running and create the database:

```sql
CREATE DATABASE data_nethouse;
```

**Note:** The table will be created automatically when you run the service. No manual SQL scripts needed!

### 3. Configure MQTT Broker

Ensure you have an MQTT broker running (e.g., Mosquitto) on `localhost:1883`.

If your MQTT broker is on a different host/port, update the `brokerUrl` in `subscriber.js`.

### 4. Update Database Configuration (if needed)

If your PostgreSQL is not on localhost or uses different credentials, update the `pgConfig` object in `subscriber.js`:

```javascript
const pgConfig = {
  host: 'localhost',        // Change if PostgreSQL is on different host
  port: 5432,              // Change if using different port
  database: 'data_nethouse',
  user: 'postgres',
  password: 'haippuntek12',
};
```

## Running the Service

```bash
npm start
```

Or directly:

```bash
node subscriber.js
```

## How It Works

1. **Connects to PostgreSQL**: Automatically creates the `sensor_data` table if it doesn't exist
2. **Connects to MQTT Broker**: Subscribes to `hydro/data` topic (matching ESP32 configuration)
3. **Receives Messages**: Parses JSON messages from ESP32
4. **Stores in PostgreSQL**: Inserts data into `sensor_data` table automatically

## Message Format

The ESP32 sends messages in this JSON format:

```json
{
  "data": "<uart_data>",
  "database": {
    "name": "data_nethouse",
    "user": "postgres",
    "password": "haippuntek12"
  }
}
```

## Database Schema

The `sensor_data` table has the following structure:

- `id`: Auto-incrementing primary key
- `data`: The sensor data from UART (TEXT)
- `received_at`: Timestamp when data was received via MQTT
- `topic`: MQTT topic (usually 'hydro/data')
- `created_at`: Timestamp when record was created

## Troubleshooting

### Connection Errors

- **PostgreSQL connection error**: Check if PostgreSQL is running and credentials are correct
- **MQTT connection error**: Verify MQTT broker is running on the specified host/port
- **Table not found**: The service automatically creates the table on startup - no manual setup needed!

### View Recent Data

```sql
SELECT * FROM sensor_data ORDER BY received_at DESC LIMIT 10;
```


## Stopping the Service

Press `Ctrl+C` to gracefully shutdown the service. It will:
- Disconnect from MQTT broker
- Close PostgreSQL connections
- Exit cleanly

