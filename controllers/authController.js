const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDB, getJWTSecret, withWrite } = require('../config/db');
const { scope, record, text, fail, publicUser, accessMessage, dates, today } = require('../lib/access');
function identity(body, creating) {
  const name = text(body.name,'Name');
  const email = text(body.email,'Email',254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Enter a valid email.');
  if ((creating || body.password) && (typeof body.password !== 'string' || body.password.length < 6 || Buffer.byteLength(body.password) > 72)) fail(400,'Password must be at least 6 characters and at most 72 bytes.');
  return {name,email};
}
async function create(req,res,role,publicSignup=false) {
  const {name,email}=identity(req.body,true);
  let institute;
  if(publicSignup) {
    institute=Number(req.body.institute_id);
    if(!await getDB().get('SELECT id FROM institutes WHERE id=?',institute)) fail(400,'Select an institute.');
  } else institute=await scope(req,true);
  const password=await bcrypt.hash(req.body.password,10);
  const student=role==='student';
  const result=await withWrite(tx=>tx.run('INSERT INTO users(name,email,password,role,phone,institute_id,status,suspension_reason) VALUES (?,?,?,?,?,?,?,?)',
    name,email,password,role,req.body.phone || null,institute,student?'suspended':'active',student?'pending':null));
  res.status(201).json({message:student?'Student created. Record payment and access dates to activate.':'Account created.',userId:result.lastID,driverId:result.lastID});
}
exports.signup=(req,res)=>create(req,res,'student',true);
exports.registerStudent=(req,res)=>create(req,res,'student');
exports.registerDriver=(req,res)=>create(req,res,'driver');
exports.registerAdmin=(req,res)=>create(req,res,'admin');
exports.login=async(req,res)=>{
  const email=String(req.body.email || '').trim().toLowerCase();
  const user=await getDB().get('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE lower(u.email)=?',email);
  if(!user || typeof req.body.password!=='string' || !await bcrypt.compare(req.body.password,user.password)) fail(401,'Invalid email or password.');
  const message=accessMessage(user);
  if(message) fail(403,message,'ACCOUNT_SUSPENDED');
  const token=jwt.sign({id:user.id},getJWTSecret(),{expiresIn:'24h'});
  res.json({token,user:publicUser(user)});
};
exports.me=(req,res)=>res.json(publicUser(req.user));
async function list(req,res,role) {
  const institute=await scope(req);
  const rows=await getDB().all('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE u.role=?'+(institute?' AND u.institute_id=?':'')+' ORDER BY u.name',...[role,...(institute?[institute]:[])]);
  res.json(rows.map(publicUser));
}
exports.getAllStudents=(req,res)=>list(req,res,'student');
exports.getAllDrivers=(req,res)=>list(req,res,'driver');
exports.getAllAdmins=(req,res)=>list(req,res,'admin');
async function update(req,res,role) {
  const user=await record(req,'users',role);
  const {name,email}=identity(req.body,false);
  const password=req.body.password?await bcrypt.hash(req.body.password,10):user.password;
  await withWrite(tx=>tx.run('UPDATE users SET name=?,email=?,password=?,phone=? WHERE id=?',name,email,password,req.body.phone ?? user.phone,user.id));
  res.json({message:'Account updated.'});
}
exports.updateStudent=(req,res)=>update(req,res,'student');
exports.updateDriver=(req,res)=>update(req,res,'driver');
exports.updateAdmin=(req,res)=>update(req,res,'admin');
async function remove(req,res,role) {
  const user=await record(req,'users',role);
  await withWrite(async tx=>{
    await tx.run('UPDATE buses SET driver_id=NULL WHERE driver_id=?',user.id);
    await tx.run('UPDATE payments SET student_id=NULL WHERE student_id=?',user.id);
    await tx.run('DELETE FROM users WHERE id=?',user.id);
  });
  req.io?.in('user:'+user.id).disconnectSockets(true);
  res.json({message:'Account deleted.'});
}
exports.deleteStudent=(req,res)=>remove(req,res,'student');
exports.deleteDriver=(req,res)=>remove(req,res,'driver');
exports.deleteAdmin=(req,res)=>remove(req,res,'admin');
exports.setAccess=async(req,res)=>{
  const user=await record(req,'users','student');
  const {status,access_start,access_end}=req.body;
  if(!['active','suspended'].includes(status)) fail(400,'Choose active or suspended.');
  if(status==='active') {
    dates(access_start,access_end);
    if(access_end<today()) fail(400,'An expired period cannot be activated.');
  }
  await withWrite(tx=>tx.run('UPDATE users SET status=?,suspension_reason=?,access_start=?,access_end=? WHERE id=?',
    status,status==='suspended'?'admin':null,status==='active'?access_start:user.access_start,status==='active'?access_end:user.access_end,user.id));
  req.io?.in('user:'+user.id).disconnectSockets(true);
  res.json({message:status==='active'?'Access period saved.':'Student suspended by admin.'});
};
exports.recordPayment=async(req,res)=>{
  const user=await record(req,'users','student');
  const {access_start,access_end}=req.body; dates(access_start,access_end);
  if(access_end<today()) fail(400,'Use a current or future access end date.');
  const amount=Number(req.body.amount);
  if(!Number.isFinite(amount)||amount<=0||amount>10000000||Math.abs(amount*100-Math.round(amount*100))>0.000001) fail(400,'Enter a positive payment with at most 2 decimal places.');
  const currency=String(req.body.currency||'PKR').toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) fail(400,'Use a 3-letter currency code.');
  const reference=String(req.body.reference||'').trim().slice(0,200);
  const result=await withWrite(async tx=>{
    const payment=await tx.run('INSERT INTO payments(student_id,institute_id,amount_cents,currency,access_start,access_end,reference,recorded_by) VALUES (?,?,?,?,?,?,?,?)',
      user.id,user.institute_id,Math.round(amount*100),currency,access_start,access_end,reference,req.userId);
    await tx.run("UPDATE users SET status='active',suspension_reason=NULL,access_start=?,access_end=? WHERE id=?",access_start,access_end,user.id);
    return payment;
  });
  res.status(201).json({message:'Payment recorded and access period updated.',paymentId:result.lastID});
};
exports.paymentHistory=async(req,res)=>{
  const user=await record(req,'users','student');
  res.json(await getDB().all('SELECT p.*,u.name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id=p.recorded_by WHERE student_id=? ORDER BY p.id DESC',user.id));
};
