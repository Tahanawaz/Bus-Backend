const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { open } = require('sqlite');

const dbPath = path.resolve(__dirname, '../database.sqlite');

let db;

async function initDB() {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student', -- 'admin', 'driver', 'student'
      phone TEXT
    );

    CREATE TABLE IF NOT EXISTS buses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      number_plate TEXT UNIQUE NOT NULL,
      driver_id INTEGER,
      route TEXT,
      lat REAL,
      lng REAL,
      status TEXT DEFAULT 'On time',
      current_stop TEXT,
      departure_time TEXT,
      FOREIGN KEY(driver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      stops TEXT NOT NULL, -- JSON string array of stop names
      etas TEXT NOT NULL -- JSON string array of ETAs
    );
  `);

  // Ensure columns exist for existing databases
  try {
    await db.run('ALTER TABLE users ADD COLUMN phone TEXT');
  } catch (e) {}
  try {
    await db.run('ALTER TABLE buses ADD COLUMN current_stop TEXT');
  } catch (e) {}
  try {
    await db.run('ALTER TABLE buses ADD COLUMN departure_time TEXT');
  } catch (e) {}

  console.log('Connected to the SQLite database and tables ensured.');
  return db;
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB };
