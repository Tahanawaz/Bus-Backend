const { getDB, withWrite } = require('../config/db');
const { fail } = require('../lib/access');

const allowed = new Set(['privacy', 'terms']);
const label = type => type === 'privacy' ? 'Privacy Policy' : 'Terms of Use';

function typeFrom(req) {
  const type = String(req.params.type || '').toLowerCase();
  if (!allowed.has(type)) fail(404, 'Policy document not found.');
  return type;
}

exports.list = async (req, res) => {
  const rows = await getDB().all('SELECT type,original_name,updated_at,octet_length(file_data) AS size FROM policy_documents ORDER BY type');
  res.json(rows.map(row => ({ ...row, title: label(row.type) })));
};

exports.pdf = async (req, res) => {
  const type = typeFrom(req);
  const document = await getDB().get('SELECT original_name,mime_type,file_data FROM policy_documents WHERE type=?', type);
  if (!document) fail(404, label(type) + ' has not been uploaded yet.');
  const safeName = document.original_name.replace(/[^a-z0-9._-]+/gi, '-');
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Content-Disposition', `inline; filename="${safeName}"`);
  res.type('application/pdf').send(document.file_data);
};

exports.upload = async (req, res) => {
  const type = typeFrom(req);
  const data = req.body;
  if (!Buffer.isBuffer(data) || !data.length) fail(400, 'Choose a PDF file.');
  if (data.length > 10 * 1024 * 1024) fail(413, 'PDF must be 10 MB or smaller.');
  if (data.length < 5 || data.subarray(0, 5).toString() !== '%PDF-') fail(400, 'Use a valid PDF file.');
  let originalName = 'smarttrack-' + type + '.pdf';
  try { originalName = decodeURIComponent(String(req.headers['x-file-name'] || originalName)); } catch { /* use safe default */ }
  originalName = originalName.replace(/[\\/\r\n]/g, '').trim().slice(0, 180) || ('smarttrack-' + type + '.pdf');
  if (!originalName.toLowerCase().endsWith('.pdf')) originalName += '.pdf';
  await withWrite(tx => tx.run(`INSERT INTO policy_documents(type,original_name,mime_type,file_data,uploaded_by,updated_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(type) DO UPDATE SET original_name=EXCLUDED.original_name,mime_type=EXCLUDED.mime_type,file_data=EXCLUDED.file_data,uploaded_by=EXCLUDED.uploaded_by,updated_at=CURRENT_TIMESTAMP`,
    type, originalName, 'application/pdf', data, req.userId));
  res.json({ message: label(type) + ' uploaded successfully.' });
};

exports.remove = async (req, res) => {
  const type = typeFrom(req);
  const result = await withWrite(tx => tx.run('DELETE FROM policy_documents WHERE type=?', type));
  if (!result.changes) fail(404, label(type) + ' has not been uploaded yet.');
  res.json({ message: label(type) + ' removed.' });
};
