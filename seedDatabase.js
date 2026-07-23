const bcrypt = require('bcrypt');
const { initDB, getDB } = require('./config/db');

async function seedDatabase() {
  await initDB();
  const db = getDB();

  console.log('Seeding database with demo data...');

  // 1. Clear existing data to prevent duplicates during demo
  await db.run('DELETE FROM users');
  await db.run('DELETE FROM buses');
  await db.run('DELETE FROM routes');

  // 2. Create Users (Admin, Driver, Student)
  const password = await bcrypt.hash('password123', 10);

  const adminResult = await db.run(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    ['Super Admin', 'admin@smartbus.com', password, 'admin']
  );

  const driverResult = await db.run(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    ['John Driver', 'driver@smartbus.com', password, 'driver']
  );

  await db.run(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    ['Alice Student', 'student@smartbus.com', password, 'student']
  );

  console.log('Created Users: Admin, Driver, Student (Password: password123)');

  // 3. Create a Route
  const routeName = 'Campus Express Route A';
  const stops = ['Main Gate', 'Library', 'Science Block', 'Hostel 1'];
  const etas = ['5 mins', '10 mins', '15 mins', '20 mins'];

  await db.run(
    'INSERT INTO routes (name, stops, etas) VALUES (?, ?, ?)',
    [routeName, JSON.stringify(stops), JSON.stringify(etas)]
  );

  console.log('Created Route: Campus Express Route A');

  // 4. Create a Bus and assign to Driver
  const driverId = driverResult.lastID;
  await db.run(
    'INSERT INTO buses (name, number_plate, driver_id, route, lat, lng, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['Bus 101 - Blue Line', 'LHE-4455', driverId, routeName, 31.5204, 74.3587, 'On time']
  );

  console.log('Created Bus 101 and assigned to John Driver with live location.');
  console.log('--- SEEDING COMPLETE ---');
}

seedDatabase().catch(console.error);
