const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const { getDB, getJWTSecret, withWrite } = require('../config/db');
const { scope, record, text, fail, publicUser, accessMessage, dates, today } = require('../lib/access');
function identity(body, creating) {
  const name = text(body.name,'Name');
  const email = text(body.email,'Email',254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Enter a valid email.');
  if ((creating || body.password) && (typeof body.password !== 'string' || body.password.length < 6 || Buffer.byteLength(body.password) > 72)) fail(400,'Password must be at least 6 characters and at most 72 bytes.');
  return {name,email};
}
async function create(req,res,role) {
  const {name,email}=identity({...req.body,password:undefined},false);
  const institute=await scope(req,true);
  const password=await bcrypt.hash('password123',10);
  const student=role==='student';
  const result=await withWrite(async tx=>{
    if(role==='admin' && await tx.get("SELECT id FROM users WHERE role='admin' AND institute_id=?",institute)) fail(409,'This institute already has an admin. Use Change admin instead.');
    return tx.run('INSERT INTO users(name,email,password,role,phone,institute_id,status,suspension_reason) VALUES (?,?,?,?,?,?,?,?)',
    name,email,password,role,req.body.phone || null,institute,student?'suspended':'active',student?'pending':null);
  });
  res.status(201).json({message:student?'Student created. Record payment and access dates to activate.':'Account created.',userId:result.lastID,driverId:result.lastID});
}
exports.registerStudent=(req,res)=>create(req,res,'student');
exports.registerDriver=(req,res)=>create(req,res,'driver');
exports.registerAdmin=(req,res)=>create(req,res,'admin');
function excelText(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object' && typeof value.text === 'string') return value.text.trim();
  return String(cell?.text ?? value ?? '').trim();
}
exports.studentImportTemplate=async(req,res)=>{
  const workbook=new ExcelJS.Workbook();
  workbook.creator='SmartTrack';
  const sheet=workbook.addWorksheet('Students');
  sheet.columns=[
    {header:'Name',key:'name',width:28},
    {header:'Email',key:'email',width:34},
    {header:'Phone',key:'phone',width:20}
  ];
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2563EB'}};
  sheet.views=[{state:'frozen',ySplit:1}];
  const instructions=workbook.addWorksheet('Instructions');
  instructions.getColumn(1).width=95;
  ['SmartTrack student import template','Enter one student per row in the Students sheet.','Name and Email are required. Phone is optional.','Imported students use temporary password password123 and remain suspended until payment/access is recorded.','Do not rename or remove the header row. Maximum 1,000 student rows per upload.'].forEach((line,index)=>instructions.getCell(index+1,1).value=line);
  instructions.getCell('A1').font={bold:true,size:15};
  const buffer=await workbook.xlsx.writeBuffer();
  res.set('Content-Disposition','attachment; filename="smarttrack-student-import-template.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
};
exports.importStudents=async(req,res)=>{
  const institute=await scope(req,true);
  const data=req.body;
  if(!Buffer.isBuffer(data)||!data.length)fail(400,'Choose an Excel .xlsx file.');
  if(data.length>5*1024*1024)fail(413,'Excel file must be 5 MB or smaller.');
  if(data.length<4||data[0]!==0x50||data[1]!==0x4b)fail(400,'Use a valid Excel .xlsx file.');
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(data);}catch{fail(400,'This Excel file could not be read. Download and use the SmartTrack template.');}
  const sheet=workbook.getWorksheet('Students')||workbook.worksheets[0];
  if(!sheet)fail(400,'The Excel file has no worksheet.');
  const header={};
  sheet.getRow(1).eachCell((cell,column)=>{header[excelText(cell).toLowerCase().replace(/[^a-z]/g,'')]=column;});
  if(!header.name||!header.email)fail(400,'Header row must contain Name and Email columns.');
  if(sheet.actualRowCount-1>1000)fail(400,'Import a maximum of 1,000 student rows at a time.');
  const rows=[];const errors=[];const seen=new Set();
  for(let number=2;number<=sheet.actualRowCount;number++){
    const row=sheet.getRow(number);
    const name=excelText(row.getCell(header.name));
    const email=excelText(row.getCell(header.email)).toLowerCase();
    const phone=header.phone?excelText(row.getCell(header.phone)):'';
    if(!name&&!email&&!phone)continue;
    let message='';
    if(!name||name.length>160)message='Name is required and must be 160 characters or fewer.';
    else if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))message='Enter a valid email address.';
    else if(phone.length>30)message='Phone must be 30 characters or fewer.';
    else if(seen.has(email))message='Duplicate email in this Excel file.';
    if(message){errors.push({row:number,email,message});continue;}
    seen.add(email);rows.push({row:number,name,email,phone});
  }
  if(!rows.length&&errors.length===0)fail(400,'No student rows were found in the Excel file.');
  const password=await bcrypt.hash('password123',10);
  let created=0;
  await withWrite(async tx=>{
    for(const student of rows){
      const result=await tx.run(`INSERT INTO users(name,email,password,role,phone,institute_id,status,suspension_reason)
        VALUES (?,?,?,'student',?,?, 'suspended','pending') ON CONFLICT(email) DO NOTHING`,student.name,student.email,password,student.phone||null,institute);
      if(result.changes)created++;else errors.push({row:student.row,email:student.email,message:'Email already exists.'});
    }
  });
  res.status(created?201:200).json({message:created+' student'+(created===1?'':'s')+' imported.',created,skipped:errors.length,errors:errors.slice(0,100)});
};
exports.login=async(req,res)=>{
  const email=String(req.body.email || '').trim().toLowerCase();
  const user=await getDB().get('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE lower(u.email)=?',email);
  if(!user || typeof req.body.password!=='string' || !await bcrypt.compare(req.body.password,user.password)) fail(401,'Invalid email or password.');
  const message=accessMessage(user);
  if(message) fail(403,message,'ACCOUNT_SUSPENDED');
  if(user.must_change_password) {
    const changeToken=jwt.sign({id:user.id,version:user.token_version,purpose:'password-change'},getJWTSecret(),{expiresIn:'10m'});
    return res.json({requiresPasswordChange:true,changeToken});
  }
  const token=jwt.sign({id:user.id,version:user.token_version,purpose:'session'},getJWTSecret(),{expiresIn:'24h'});
  res.json({token,user:publicUser(user)});
};
exports.me=(req,res)=>res.json(publicUser(req.user));
exports.updateProfile=async(req,res)=>{
  const {name,email}=identity(req.body,false);
  const phone=String(req.body.phone||'').trim();
  if(phone.length>30)fail(400,'Phone number must be at most 30 characters.');
  await withWrite(tx=>tx.run('UPDATE users SET name=?,email=?,phone=? WHERE id=?',name,email,phone||null,req.userId));
  const user=await getDB().get('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE u.id=?',req.userId);
  res.json({message:'Profile updated.',user:publicUser(user)});
};
exports.changePassword=async(req,res)=>{
  const current=req.body.currentPassword;
  const password=req.body.password;
  if(typeof current!=='string'||!await bcrypt.compare(current,req.user.password))fail(400,'Current password is incorrect.');
  if(typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)fail(400,'Use at least 8 characters and at most 72 bytes.');
  if(password!==req.body.confirmPassword)fail(400,'Passwords do not match.');
  if(await bcrypt.compare(password,req.user.password))fail(400,'Choose a password different from your current password.');
  const hash=await bcrypt.hash(password,10);
  await withWrite(tx=>tx.run('UPDATE users SET password=?,token_version=token_version+1 WHERE id=?',hash,req.userId));
  const user=await getDB().get('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE u.id=?',req.userId);
  const token=jwt.sign({id:user.id,version:user.token_version,purpose:'session'},getJWTSecret(),{expiresIn:'24h'});
  req.io?.in('user:'+user.id).disconnectSockets(true);
  res.json({message:'Password changed successfully.',token,user:publicUser(user)});
};
exports.avatar=async(req,res)=>{
  const avatar=await getDB().get('SELECT avatar_data,avatar_mime FROM users WHERE id=?',req.userId);
  if(!avatar?.avatar_data)fail(404,'Profile photo not found.');
  res.set('Cache-Control','private, no-store');
  res.type(avatar.avatar_mime).send(avatar.avatar_data);
};
exports.updateAvatar=async(req,res)=>{
  const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
  const data=req.body;
  if(!Buffer.isBuffer(data)||!data.length)fail(400,'Choose a profile photo.');
  if(data.length>5*1024*1024)fail(413,'Profile photo must be 5 MB or smaller.');
  const png=mime==='image/png'&&data.length>=8&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=mime==='image/jpeg'&&data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff;
  const webp=mime==='image/webp'&&data.length>=12&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
  if(!png&&!jpeg&&!webp)fail(400,'Use a valid PNG, JPEG, or WebP image.');
  await withWrite(tx=>tx.run('UPDATE users SET avatar_data=?,avatar_mime=? WHERE id=?',data,mime,req.userId));
  const user=await getDB().get('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE u.id=?',req.userId);
  res.json({message:'Profile photo updated.',user:publicUser(user)});
};
exports.deleteAvatar=async(req,res)=>{
  await withWrite(tx=>tx.run('UPDATE users SET avatar_data=NULL,avatar_mime=NULL WHERE id=?',req.userId));
  const user=await getDB().get('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE u.id=?',req.userId);
  res.json({message:'Profile photo removed.',user:publicUser(user)});
};
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
  const reset=Boolean(req.body.password)||(role==='admin'&&req.body.replace_admin===true);
  const password=reset?await bcrypt.hash(role==='admin'&&req.body.replace_admin===true?'password123':req.body.password,10):user.password;
  await withWrite(tx=>tx.run('UPDATE users SET name=?,email=?,password=?,phone=?,must_change_password=?,token_version=token_version+? WHERE id=?',name,email,password,req.body.phone ?? user.phone,reset?1:user.must_change_password,reset?1:0,user.id));
  if(reset)req.io?.in('user:'+user.id).disconnectSockets(true);
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

exports.changeInitialPassword=async(req,res)=>{
  let claims;
  try { claims=jwt.verify(req.body.changeToken,getJWTSecret()); } catch { fail(401,'Password change session expired. Sign in again.'); }
  if(claims.purpose!=='password-change')fail(401,'Sign in to change your initial password.');
  const user=await getDB().get('SELECT * FROM users WHERE id=?',claims.id);
  if(!user||!user.must_change_password||claims.version!==user.token_version)fail(401,'Password change session is no longer valid. Sign in again.');
  const message=accessMessage(user);if(message)fail(403,message,'ACCOUNT_SUSPENDED');
  const password=req.body.password;
  if(typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)fail(400,'Use at least 8 characters and at most 72 bytes.');
  if(password==='password123'||await bcrypt.compare(password,user.password))fail(400,'Choose a different password from your temporary or current password.');
  if(password!==req.body.confirmPassword)fail(400,'Passwords do not match.');
  const hash=await bcrypt.hash(password,10);
  await withWrite(async tx=>{
    const result=await tx.run('UPDATE users SET password=?,must_change_password=0,token_version=token_version+1 WHERE id=? AND token_version=? AND must_change_password=1',hash,user.id,claims.version);
    if(!result.changes)fail(401,'This password change session has already been used. Sign in again.');
  });
  req.io?.in('user:'+user.id).disconnectSockets(true);
  res.json({message:'Password changed. Sign in with your new password.'});
};
