const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
let db;
let secret;
let writes = Promise.resolve();
async function withWrite(fn) {
  const task = writes.then(async () => {
    await db.exec('BEGIN IMMEDIATE');
    try { const result = await fn(db); await db.exec('COMMIT'); return result; }
    catch (err) { await db.exec('ROLLBACK'); throw err; }
  });
  writes = task.catch(() => {});
  return task;
}
async function initDB(filename = process.env.DB_PATH || path.resolve(__dirname, '../database.sqlite')) {
  db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', phone TEXT);
    CREATE TABLE IF NOT EXISTS buses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, number_plate TEXT UNIQUE NOT NULL, driver_id INTEGER, route TEXT, lat REAL, lng REAL, status TEXT DEFAULT 'On time', current_stop TEXT, departure_time TEXT);
    CREATE TABLE IF NOT EXISTS routes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, stops TEXT NOT NULL, etas TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS institutes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, address TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const additions = {
    users: { phone: 'TEXT', institute_id: 'INTEGER REFERENCES institutes(id)', status: "TEXT NOT NULL DEFAULT 'active'", suspension_reason: 'TEXT', access_start: 'TEXT', access_end: 'TEXT' },
    buses: { institute_id: 'INTEGER REFERENCES institutes(id)', route_id: 'INTEGER REFERENCES routes(id)', current_stop: 'TEXT', departure_time: 'TEXT' },
    routes: { institute_id: 'INTEGER REFERENCES institutes(id)' }
  };
  await withWrite(async tx => {
    for (const [table, columns] of Object.entries(additions)) {
      const existing = (await tx.all('PRAGMA table_info(' + table + ')')).map(c => c.name);
      for (const [name, definition] of Object.entries(columns)) {
        if (!existing.includes(name)) await tx.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + definition);
      }
    }
    if (!await tx.get("SELECT key FROM app_settings WHERE key = 'multi_institute_v1'")) {
      await tx.run("INSERT OR IGNORE INTO institutes(name) VALUES ('Main Campus')");
      const institute = await tx.get("SELECT id FROM institutes WHERE name = 'Main Campus'");
      await tx.run("UPDATE users SET role = 'superadmin' WHERE role = 'admin' AND institute_id IS NULL");
      await tx.run("UPDATE users SET institute_id = ? WHERE role != 'superadmin' AND institute_id IS NULL", institute.id);
      await tx.run('UPDATE buses SET institute_id = ? WHERE institute_id IS NULL', institute.id);
      await tx.run('UPDATE routes SET institute_id = ? WHERE institute_id IS NULL', institute.id);
      await tx.run('UPDATE buses SET route_id = (SELECT id FROM routes WHERE routes.name = buses.route AND routes.institute_id = buses.institute_id LIMIT 1) WHERE route_id IS NULL');
      await tx.run("INSERT INTO app_settings(key,value) VALUES ('multi_institute_v1','done')");
    }
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES users(id), institute_id INTEGER NOT NULL REFERENCES institutes(id),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL DEFAULT 'PKR',
        access_start TEXT NOT NULL, access_end TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '',
        recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS users_institute_role ON users(institute_id, role);
      CREATE INDEX IF NOT EXISTS buses_institute ON buses(institute_id);
      CREATE INDEX IF NOT EXISTS routes_institute ON routes(institute_id);
      CREATE INDEX IF NOT EXISTS payments_student ON payments(student_id);
    `);
    await tx.run("INSERT OR IGNORE INTO app_settings(key,value) VALUES ('jwt_secret',?)", crypto.randomBytes(48).toString('hex'));
  });
  secret = process.env.JWT_SECRET || (await db.get("SELECT value FROM app_settings WHERE key='jwt_secret'")).value;
  return db;
}
module.exports = { initDB, getDB: () => db, getJWTSecret: () => secret, withWrite };
