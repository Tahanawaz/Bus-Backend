const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'No token provided' });

  jwt.verify(token.split(' ')[1], process.env.JWT_SECRET || 'secretkey', (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  });
};

const isAdmin = (req, res, next) => {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Require Admin Role' });
  next();
};

const isDriver = (req, res, next) => {
  if (req.userRole !== 'driver') return res.status(403).json({ error: 'Require Driver Role' });
  next();
};

module.exports = { verifyToken, isAdmin, isDriver };
