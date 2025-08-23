// Quick test script to check connection
const fetch = require('node-fetch');

async function testConnection() {
  try {
    console.log('Testing server health...');
    const response = await fetch('http://localhost:7654/health');
    const result = await response.json();
    console.log('Health check result:', result);

    if (result.status === 'ok') {
      console.log('✅ Server is healthy and connected to OpenCode');
    } else {
      console.log('❌ Server has issues:', result.error);
    }
  } catch (error) {
    console.log('❌ Cannot connect to server:', error.message);
  }
}

testConnection();
