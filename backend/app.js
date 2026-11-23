const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const complaintRoutes = require('./routes/complaintRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const slaRoutes = require('./routes/slaRoutes');

const app = express();

// Middleware: Request Body Parsing with explicit 10mb ceiling to support base64 evidence and prevent unbounded DoS
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware: CORS Configuration for local development & cross-port Vite instances
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // Allow non-browser requests (curl, Postman, server-to-server)

  // Allow any localhost, 127.0.0.1, or [::1] on any port (5173, 5174, 5175, 3000, 4173, etc.)
  const localOriginRegex = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  if (localOriginRegex.test(origin)) {
    return true;
  }

  // Explicit allowed production/staging origins if defined
  const explicitOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (explicitOrigins.includes(origin)) {
    return true;
  }

  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      // Return null, false for disallowed origins so CORS headers are omitted without throwing a 500 error
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  })
);

// Route Registration
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/sla', slaRoutes);

// Root route handler for basic API check
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'CivicTrack API',
    version: '1.0.0',
    description: 'Civic complaint management and resolution platform backend API',
    healthCheck: '/api/health'
  });
});

// Catch-all 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint '${req.originalUrl}' does not exist.`
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  const statusCode = err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  console.error(`[Error] ${err.message}`);

  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal Server Error' : err.name || 'Error',
    message: isProduction && statusCode === 500 ? 'An unexpected error occurred on the server.' : err.message
  });
});

module.exports = app;
