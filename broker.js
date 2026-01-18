const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);
const port = 1883;

server.listen(port, '0.0.0.0', () => {
  console.log('🚀 MQTT Broker started');
  console.log(`📡 Listening on 0.0.0.0:${port}`);
  console.log(`   Local:   mqtt://localhost:${port}`);
  console.log(`   Network: mqtt://192.168.127.51:${port}`);
  console.log('\n✅ Ready to accept connections from ESP32 and subscribers');
});

aedes.on('client', (client) => {
  console.log(`\n👤 Client connected: ${client.id}`);
});

aedes.on('clientDisconnect', (client) => {
  console.log(`👋 Client disconnected: ${client.id}`);
});

aedes.on('publish', (packet, client) => {
  if (client) {
    console.log(`📤 Message published by ${client.id} to topic: ${packet.topic}`);
  }
});

aedes.on('subscribe', (subscriptions, client) => {
  console.log(`🔔 Client ${client.id} subscribed to: ${subscriptions.map(s => s.topic).join(', ')}`);
});

// Handle errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${port} is already in use. Is another MQTT broker running?`);
  } else {
    console.error('❌ Server error:', err);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down MQTT broker...');
  server.close(() => {
    console.log('✅ MQTT broker stopped');
    process.exit(0);
  });
});

