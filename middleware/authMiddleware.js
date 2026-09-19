const jwt = require('jsonwebtoken');
const { getDB, getJWTSecret } = require('../config/db');
const { accessMessage, fail } = require('../lib/access');
async function authenticate(token) {
  let decoded;
  try { decoded = jwt.verify(token, getJWTSecret()); } catch { fail(401,'Please sign in again.'); }
  if(decoded.purpose !== 'session') fail(401,'Please sign in again.');
  const user = await getDB().get('SELECT u.*, i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE u.id=?', decoded.id);
  if (!user) fail(401,'Account no longer exists.');
  if(decoded.version !== user.token_version) fail(401,'Your credentials changed. Please sign in again.');
  if(user.must_change_password) fail(401,'Change your password to continue.','PASSWORD_CHANGE_REQUIRED');
  const message = accessMessage(user);
  if (message) fail(403,message,'ACCOUNT_SUSPENDED');
  return user;
}
async function verifyToken(req,res,next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) fail(401,'Please sign in.');
    req.user = await authenticate(header.slice(7));
    req.userId = req.user.id; req.userRole = req.user.role; next();
  } catch(err) { next(err); }
}
const isAdmin = (req,res,next) => ['admin','superadmin'].includes(req.userRole) ? next() : res.status(403).json({error:'Administrator access required.'});
const isSuperAdmin = (req,res,next) => req.userRole === 'superadmin' ? next() : res.status(403).json({error:'Super admin access required.'});
const isDriver = (req,res,next) => req.userRole === 'driver' ? next() : res.status(403).json({error:'Driver access required.'});
module.exports={authenticate,verifyToken,isAdmin,isSuperAdmin,isDriver};
