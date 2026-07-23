const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDB } = require('../config/db');

exports.signup = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const db = getDB();

    // Only allow student signup directly, or admin can be registered via a special endpoint/seed
    const userRole = role === 'student' ? 'student' : 'student';

    const existingUser = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, userRole]
    );

    res.status(201).json({ message: 'User created successfully', userId: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.registerDriver = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const db = getDB();

    const existingUser = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUser) return res.status(400).json({ error: 'Driver already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashedPassword, 'driver', phone || null]
    );

    res.status(201).json({ message: 'Driver created successfully', driverId: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = getDB();

    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllDrivers = async (req, res) => {
  try {
    const db = getDB();
    const drivers = await db.all('SELECT id, name, email, phone FROM users WHERE role = ?', ['driver']);
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, phone } = req.body;
    const db = getDB();

    let query = 'UPDATE users SET name = ?, email = ?, phone = ?';
    let params = [name, email, phone || null];

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += ', password = ?';
      params.push(hashedPassword);
    }

    query += ' WHERE id = ? AND role = "driver"';
    params.push(id);

    await db.run(query, params);
    res.json({ message: 'Driver updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDB();

    // Also unassign from buses
    await db.run('UPDATE buses SET driver_id = NULL WHERE driver_id = ?', [id]);
    
    await db.run('DELETE FROM users WHERE id = ? AND role = "driver"', [id]);
    res.json({ message: 'Driver deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllStudents = async (req, res) => {
  try {
    const db = getDB();
    const students = await db.all('SELECT id, name, email FROM users WHERE role = ?', ['student']);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password } = req.body;
    const db = getDB();

    let query = 'UPDATE users SET name = ?, email = ?';
    let params = [name, email];

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += ', password = ?';
      params.push(hashedPassword);
    }

    query += ' WHERE id = ? AND role = "student"';
    params.push(id);

    await db.run(query, params);
    res.json({ message: 'Student updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDB();

    await db.run('DELETE FROM users WHERE id = ? AND role = "student"', [id]);
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
