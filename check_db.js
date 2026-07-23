const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

async function check() {
  const db = await open({
    filename: path.resolve(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });

  console.log('--- ROUTES ---');
  const routes = await db.all('SELECT * FROM routes');
  console.log(JSON.stringify(routes, null, 2));

  console.log('--- DRIVERS ---');
  const drivers = await db.all('SELECT * FROM users WHERE role="driver"');
  console.log(JSON.stringify(drivers, null, 2));

  console.log('--- BUSES ---');
  const buses = await db.all('SELECT * FROM buses');
  console.log(JSON.stringify(buses, null, 2));
}

check().catch(console.error);
