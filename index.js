const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { initDB } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const busRoutes = require('./routes/busRoutes');
const routeRoutes = require('./routes/routeRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// TEST ROUTE - Directly in index.js to confirm it's reachable
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', port: 5001, timestamp: new Date().toISOString() });
});

// Attach io to req for controllers to use
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/buses', busRoutes);
app.use('/api/routes', routeRoutes);

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('updateLocation', (data) => {
    io.emit('locationUpdate', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5001;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`>>> SmartBus Server is ACTIVE on port ${PORT} <<<`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});
