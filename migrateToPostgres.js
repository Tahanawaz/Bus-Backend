require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { initDB, getDB, withWrite } = require('./config/db');

const sourceFile = process.env.SQLITE_SOURCE || path.resolve(__dirname, 'database.sqlite');
const tables = {
  institutes: ['id','name','address','created_at'],
  users: ['id','name','email','password','role','phone','must_change_password','token_version','institute_id','status','suspension_reason','access_start','access_end','avatar_data','avatar_mime'],
  routes: ['id','name','stops','etas','stop_coordinates','institute_id'],
  buses: ['id','name','number_plate','driver_id','route','lat','lng','status','current_stop','departure_time','institute_id','route_id'],
  payments: ['id','student_id','institute_id','amount_cents','currency','access_start','access_end','reference','recorded_by','recorded_at'],
  app_settings: ['key','value'],
};

function timestamp(value) {
  if (typeof value !== 'string' || /(?:Z|[+-]\d\d:\d\d)$/.test(value)) return value;
  return value.replace(' ', 'T') + 'Z';
}

async function migrate() {
  const source = await open({ filename: sourceFile, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  await initDB();
  const target = getDB();
  try {
    const existing = await target.get('SELECT (SELECT count(*) FROM institutes)+(SELECT count(*) FROM users)+(SELECT count(*) FROM routes)+(SELECT count(*) FROM buses)+(SELECT count(*) FROM payments) AS total');
    if (existing.total) throw new Error('PostgreSQL already contains application data; migration stopped without changing it.');
    const sourceTables = new Set((await source.all("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name));
    const counts = {};
    await withWrite(async tx => {
      for (const [table, expectedColumns] of Object.entries(tables)) {
        if (!sourceTables.has(table)) { counts[table] = 0; continue; }
        const available = new Set((await source.all('PRAGMA table_info(' + table + ')')).map(column => column.name));
        const columns = expectedColumns.filter(column => available.has(column));
        const rows = await source.all('SELECT ' + columns.join(',') + ' FROM ' + table + ' ORDER BY ' + (table === 'app_settings' ? 'key' : 'id'));
        for (const row of rows) {
          if (table === 'institutes' && row.created_at) row.created_at = timestamp(row.created_at);
          if (table === 'payments' && row.recorded_at) row.recorded_at = timestamp(row.recorded_at);
          const placeholders = columns.map(() => '?').join(',');
          const conflict = table === 'app_settings' ? ' ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value' : ' ON CONFLICT (id) DO NOTHING';
          await tx.run('INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES (' + placeholders + ')' + conflict, ...columns.map(column => row[column]));
        }
        counts[table] = rows.length;
      }
      for (const table of ['institutes','users','routes','buses','payments']) {
        await tx.exec("SELECT setval(pg_get_serial_sequence('" + table + "','id'),COALESCE((SELECT MAX(id) FROM " + table + "),1),(SELECT COUNT(*)>0 FROM " + table + '))');
      }
    });
    console.log('SQLite to PostgreSQL migration complete:', counts);
  } finally {
    await source.close();
    await getDB().close();
  }
}

migrate().catch(error => { console.error(error.message); process.exitCode = 1; });
