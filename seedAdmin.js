const bcrypt = require('bcrypt');
const { initDB, getDB } = require('./config/db');

async function seedAdmin() {
  await initDB();
  const db = getDB();

  const existingAdmin = await db.get('SELECT * FROM users WHERE role = ?', ['admin']);
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await db.run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      ['Super Admin', 'admin@smartbus.com', hashedPassword, 'admin']
    );
    console.log('Admin seeded: admin@smartbus.com / admin123');
  } else {
    console.log('Admin already exists.');
  }
}

seedAdmin().catch(console.error);
