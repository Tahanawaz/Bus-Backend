const { getDB } = require('../config/db');

exports.getAllRoutes = async (req, res) => {
  try {
    const db = getDB();
    const routes = await db.all(`
      SELECT r.*, b.name as bus_name, b.number_plate as bus_plate, b.lat, b.lng, u.name as driver_name
      FROM routes r 
      LEFT JOIN buses b ON r.name = b.route
      LEFT JOIN users u ON b.driver_id = u.id
    `);
    res.json(routes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addRoute = async (req, res) => {
  try {
    const { name, stops, etas } = req.body;
    const db = getDB();
    const result = await db.run(
      'INSERT INTO routes (name, stops, etas) VALUES (?, ?, ?)',
      [name, JSON.stringify(stops), JSON.stringify(etas)]
    );
    res.status(201).json({ message: 'Route added', routeId: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, stops, etas } = req.body;
    const db = getDB();
    await db.run(
      'UPDATE routes SET name = ?, stops = ?, etas = ? WHERE id = ?',
      [name, JSON.stringify(stops), JSON.stringify(etas), id]
    );
    res.json({ message: 'Route updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDB();
    await db.run('DELETE FROM routes WHERE id = ?', [id]);
    res.json({ message: 'Route deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
