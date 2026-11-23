const path = require('path');
const dotenv = require('dotenv');

// Load environment configuration from .env located in the backend directory
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');
const { startSlaScheduler, stopSlaScheduler } = require('./services/slaScheduler');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Validate essential configuration before attempting startup
if (!MONGO_URI) {
  console.error('[Startup Failure] MONGO_URI environment variable is required but not set.');
  process.exit(1);
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 16) {
  console.error('[Startup Failure] JWT_SECRET environment variable is required and must be at least 16 characters long.');
  process.exit(1);
}

if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
  console.error(`[Startup Failure] Configured PORT '${process.env.PORT}' is invalid. Must be between 1 and 65535.`);
  process.exit(1);
}

let server;

/**
 * Start the backend service:
 * 1. Connect to MongoDB.
 * 2. Start the Express HTTP listener once the database connection is confirmed.
 */
const startServer = async () => {
  try {
    console.log('[Startup] Connecting to MongoDB...');
    await connectDB();

    server = app.listen(PORT, () => {
      console.log(`[Startup] CivicTrack backend server running on port ${PORT}`);
      console.log(`[Startup] Health endpoint available at http://localhost:${PORT}/api/health`);
      startSlaScheduler(parseInt(process.env.SLA_EVALUATION_INTERVAL_MS, 10) || 60000);
    });
  } catch (error) {
    console.error(`[Startup Failure] Could not start server: ${error.message}`);
    process.exit(1);
  }
};

/**
 * Handle graceful shutdown
 */
const handleShutdown = async (signal) => {
  console.log(`\n[Shutdown] Received ${signal}. Initiating graceful shutdown...`);

  stopSlaScheduler();

  if (server) {
    server.close(() => {
      console.log('[Shutdown] HTTP server closed.');
    });
  }

  try {
    await disconnectDB();
    console.log('[Shutdown] Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error(`[Shutdown Error] Error during disconnection: ${error.message}`);
    process.exit(1);
  }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

startServer();
