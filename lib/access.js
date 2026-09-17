const { getDB, withWrite } = require('../config/db');
function fail(status, message, code) { const err = new Error(message); err.status = status; err.code = code; throw err; }
function today() { return new Date().toISOString().slice(0, 10); }
function accessMessage(user) {
  if (user.status === 'suspended' && user.suspension_reason !== 'expired') return user.suspension_reason === 'pending' ? 'Account suspended: awaiting payment and activation by your institute admin.' : 'Account suspended by admin. Please contact your institute.';
  if (user.role === 'student' && user.access_end && user.access_end < today()) return 'Your paid access period has expired. Please contact your institute admin to renew.';
  if (user.role === 'student' && user.access_start && user.access_start > today()) return 'Your access period has not started yet. Access begins on ' + user.access_start + '.';
  if (user.status === 'suspended') return 'Account suspended by admin. Please contact your institute.';
  return null;
}
function publicUser(u) {
  return { id:u.id, name:u.name, email:u.email, phone:u.phone, role:u.role, institute_id:u.institute_id, institute_name:u.institute_name,
    status:accessMessage(u) ? 'suspended':'active', access_start:u.access_start, access_end:u.access_end, suspension_reason:u.suspension_reason, access_message:accessMessage(u) };
}
async function expireStudents() {
  await withWrite(tx => tx.run("UPDATE users SET status='suspended', suspension_reason='expired' WHERE role='student' AND status='active' AND access_end IS NOT NULL AND access_end < ?", today()));
}
async function scope(req, required = false) {
  const requested = req.query.institute_id || req.body?.institute_id;
  if (req.userRole !== 'superadmin') {
    if (!req.user.institute_id) fail(403, 'No institute assigned.');
    if (requested && Number(requested) !== req.user.institute_id) fail(403, 'You cannot access another institute.');
    return req.user.institute_id;
  }
  if (!requested || requested === 'all') {
    if (required) fail(400, 'Select an institute before creating a record.');
    return null;
  }
  const id = Number(requested);
  if (!Number.isInteger(id) || id <= 0 || !await getDB().get('SELECT id FROM institutes WHERE id=?', id)) fail(400, 'Invalid institute.');
  return id;
}
async function record(req, table, role) {
  if (!['users','buses','routes'].includes(table)) throw Error('Invalid table');
  const id = Number(req.params.id);
  const row = await getDB().get('SELECT * FROM ' + table + ' WHERE id=?', id);
  const tenant = await scope(req);
  if (!row || (role && row.role !== role) || (tenant && row.institute_id !== tenant)) fail(404, 'Record not found.');
  return row;
}
function text(value, label, max=160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, label + ' is required (maximum ' + max + ' characters).');
  return value.trim();
}
function dates(start,end) {
  for (const date of [start,end]) if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) fail(400,'Use valid start and end dates.');
  if (start > end) fail(400,'End date must be on or after start date.');
}
function emit(req, institute, event, payload) { req.io?.to('institute:' + institute).to('superadmin').emit(event,payload); }
module.exports = { fail,today,accessMessage,publicUser,expireStudents,scope,record,text,dates,emit };
