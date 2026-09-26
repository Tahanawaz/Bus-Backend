const crypto = require('crypto');
const { getDB, withWrite } = require('../config/db');
const { fail, text } = require('../lib/access');

const attempts = new Map();

function rateLimit(req) {
  const now = Date.now();
  const key = crypto.createHash('sha256').update(String(req.ip || req.socket.remoteAddress || 'unknown')).digest('hex');
  const recent = (attempts.get(key) || []).filter(time => now - time < 10 * 60 * 1000);
  if (recent.length >= 5) fail(429, 'Too many demo requests. Please try again later.');
  recent.push(now); attempts.set(key, recent);
  if (attempts.size > 1000) for (const [entry,times] of attempts) if (!times.some(time => now-time < 10*60*1000)) attempts.delete(entry);
}

exports.create = async (req,res) => {
  if (String(req.body.website || '').trim()) return res.status(201).json({message:'Thank you! Your free demo request has been submitted successfully. Our team will contact you soon to arrange a suitable time.'});
  rateLimit(req);
  const name = text(req.body.name,'Name',160);
  const email = text(req.body.email,'Email',254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Enter a valid email address.');
  const phone = text(req.body.phone,'Contact number',30);
  if (!/^[+0-9][0-9\s()-]{6,29}$/.test(phone)) fail(400,'Enter a valid contact number.');
  const organization = String(req.body.organization || '').trim();
  const designation = String(req.body.designation || '').trim();
  if (organization.length > 160) fail(400,'Institute name must not exceed 160 characters.');
  if (designation.length > 120) fail(400,'Designation must not exceed 120 characters.');
  const message = text(req.body.message,'Message',2000);
  const result = await withWrite(tx => tx.run(`INSERT INTO contact_inquiries(name,email,phone,organization,designation,service,message)
    VALUES (?,?,?,?,?,'Free demo',?) RETURNING id`,name,email,phone,organization,designation,message));
  req.io?.to('superadmin').emit('contactInquiry',{id:result.lastID});
  res.status(201).json({message:'Thank you! Your free demo request has been submitted successfully. Our team will contact you soon to arrange a suitable time.',inquiryId:result.lastID});
};

exports.list = async (req,res) => {
  const status = String(req.query.status || 'all');
  if (!['all','unread','read','resolved'].includes(status)) fail(400,'Invalid inquiry status.');
  const rows = await getDB().all(`SELECT * FROM contact_inquiries${status==='all'?'':' WHERE status=?'} ORDER BY created_at DESC`,...(status==='all'?[]:[status]));
  res.json(rows);
};

exports.setStatus = async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) fail(404,'Demo request not found.');
  const status = String(req.body.status || '');
  if (!['unread','read','resolved'].includes(status)) fail(400,'Choose unread, read, or resolved.');
  const result = await withWrite(tx => tx.run('UPDATE contact_inquiries SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',status,id));
  if (!result.changes) fail(404,'Demo request not found.');
  req.io?.to('superadmin').emit('contactInquiryUpdated',{id,status});
  res.json({message:status==='resolved'?'Demo request marked resolved.':status==='read'?'Demo request marked read.':'Demo request moved back to unread.'});
};

exports.markAllRead = async (req,res) => {
  const result = await withWrite(tx => tx.run("UPDATE contact_inquiries SET status='read',updated_at=CURRENT_TIMESTAMP WHERE status='unread'"));
  req.io?.to('superadmin').emit('contactInquiryUpdated',{all:true,status:'read'});
  res.json({message:'All demo request notifications marked read.',updated:result.changes});
};

exports.remove = async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) fail(404,'Demo request not found.');
  const result = await withWrite(tx => tx.run('DELETE FROM contact_inquiries WHERE id=?',id));
  if (!result.changes) fail(404,'Demo request not found.');
  req.io?.to('superadmin').emit('contactInquiryUpdated',{id,deleted:true});
  res.json({message:'Demo request deleted.'});
};
