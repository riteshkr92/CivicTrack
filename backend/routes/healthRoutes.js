const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

/**
 * @route   GET /api/health
 * @desc    Check health status of API and database connection
 * @access  Public
 */
router.get('/', (req, res) => {
  // readyState values: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const isDbConnected = mongoose.connection.readyState === 1;

  const healthData = {
    status: isDbConnected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      api: 'up',
      database: isDbConnected ? 'connected' : 'disconnected'
    }
  };

  const httpStatus = isDbConnected ? 200 : 503;
  return res.status(httpStatus).json(healthData);
});

module.exports = router;
