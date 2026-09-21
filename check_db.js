require('dotenv').config();
const { initDB, getDB } = require('./config/db');

async function check() {
  await initDB();
  const db = getDB();
  const server = await db.get("SELECT current_database() database,current_user username,current_setting('server_version') version");
  const counts = await db.get("SELECT (SELECT count(*) FROM institutes) institutes,(SELECT count(*) FROM users) users,(SELECT count(*) FROM routes) routes,(SELECT count(*) FROM buses) buses,(SELECT count(*) FROM payments) payments");
  console.log(JSON.stringify({ server, counts }, null, 2));
  await db.close();
}

check().catch(error => { console.error(error); process.exitCode = 1; });
