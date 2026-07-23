const { getDB } = require('../config/db');

exports.getAllBuses = async (req, res) => {
  try {
    const db = getDB();
    console.log('GET /api/buses requested');
    const buses = await db.all(`
      SELECT buses.*, users.name as driver_name 
      FROM buses 
      LEFT JOIN users ON buses.driver_id = users.id
    `);
    res.json(buses);
  } catch (err) {
    console.error('Error in getAllBuses:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.addBus = async (req, res) => {
  try {
    const { name, number_plate, driver_id, route, departure_time, force } = req.body;
    const db = getDB();

    // Check if driver is already assigned
    if (driver_id && !force) {
      const existingBus = await db.get('SELECT name FROM buses WHERE driver_id = ?', [driver_id]);
      if (existingBus) {
        return res.status(409).json({ 
          error: 'Driver already assigned', 
          message: `This driver is already assigned to ${existingBus.name}. Reassign anyway?`,
          code: 'DRIVER_ASSIGNED'
        });
      }
    }

    // If force is true, unassign driver from other buses
    if (driver_id && force) {
      await db.run('UPDATE buses SET driver_id = NULL WHERE driver_id = ?', [driver_id]);
    }

    const result = await db.run(
      'INSERT INTO buses (name, number_plate, driver_id, route, departure_time, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, number_plate, driver_id, route, departure_time, 'On time']
    );
    res.status(201).json({ message: 'Bus added', busId: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateBus = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, number_plate, driver_id, route, departure_time, force } = req.body;
    const db = getDB();

    // Check if driver is already assigned to ANOTHER bus
    if (driver_id && !force) {
      const existingBus = await db.get('SELECT name FROM buses WHERE driver_id = ? AND id != ?', [driver_id, id]);
      if (existingBus) {
        return res.status(409).json({ 
          error: 'Driver already assigned', 
          message: `This driver is already assigned to ${existingBus.name}. Reassign anyway?`,
          code: 'DRIVER_ASSIGNED'
        });
      }
    }

    // If force is true, unassign driver from other buses
    if (driver_id && force) {
      await db.run('UPDATE buses SET driver_id = NULL WHERE driver_id = ? AND id != ?', [driver_id, id]);
    }

    const updates = {
      name,
      number_plate,
      driver_id,
      route,
      departure_time,
      id
    };

    // Auto-update status if departure_time is set and not already en route
    let statusUpdate = '';
    if (departure_time) {
      statusUpdate = `, status = 'Departing at ${departure_time}', current_stop = NULL`;
    }

    await db.run(
      `UPDATE buses SET name = ?, number_plate = ?, driver_id = ?, route = ?, departure_time = ? ${statusUpdate} WHERE id = ?`,
      [name, number_plate, driver_id, route, departure_time, id]
    );

    // Notify all clients of the change
    req.io.emit('busUpdated', { id, status: departure_time ? `Departing at ${departure_time}` : undefined });

    res.json({ message: 'Bus updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateBusLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const { id } = req.params;
    const db = getDB();

    await db.run('UPDATE buses SET lat = ?, lng = ? WHERE id = ?', [lat, lng, id]);

    // Emit real-time location via socket.io
    req.io.emit('locationUpdate', { id, lat, lng });

    res.json({ message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateBusStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;
    const db = getDB();

    await db.run('UPDATE buses SET status = ? WHERE id = ?', [status, id]);

    // Emit status change notification
    req.io.emit('statusUpdate', { id, status });

    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateBusStop = async (req, res) => {
  try {
    const { stopName } = req.body;
    const { id } = req.params;
    const db = getDB();

    await db.run('UPDATE buses SET current_stop = ? WHERE id = ?', [stopName, id]);
    
    // Emit stop change notification
    req.io.emit('stopUpdate', { id, current_stop: stopName });

    res.json({ message: 'Stop updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteBus = async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDB();
    await db.run('DELETE FROM buses WHERE id = ?', [id]);
    res.json({ message: 'Bus deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    const db = getDB();
    const totalBuses = await db.get('SELECT COUNT(*) as count FROM buses');
    const activeBuses = await db.get('SELECT COUNT(*) as count FROM buses WHERE status LIKE "%Moving%" OR status LIKE "%Arrived%" OR status = "On time"');
    const totalDrivers = await db.get('SELECT COUNT(*) as count FROM users WHERE role = "driver"');
    const totalStudents = await db.get('SELECT COUNT(*) as count FROM users WHERE role = "student"');

    res.json({
      totalBuses: totalBuses.count,
      activeBuses: activeBuses.count,
      totalDrivers: totalDrivers.count,
      totalStudents: totalStudents.count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMyBus = async (req, res) => {
  try {
    const db = getDB();
    console.log('Fetching bus for Driver ID:', req.userId);
    const bus = await db.get('SELECT * FROM buses WHERE driver_id = ?', [req.userId]);
    console.log('Database Result:', bus);
    if (!bus) return res.status(404).json({ error: 'No bus assigned to you yet.' });
    res.json(bus);
  } catch (err) {
    console.error('Error in getMyBus:', err.message);
    res.status(500).json({ error: err.message });
  }
};
