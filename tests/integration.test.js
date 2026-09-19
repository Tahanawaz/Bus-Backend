const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const bcrypt=require('bcrypt');
const {createServer}=require('../index');
const {getDB,withWrite}=require('../config/db');
const {today,expireStudents}=require('../lib/access');
const {io}=require('../../Bus-Frontend/node_modules/socket.io-client');
const day=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
test('multi-institute access, payments, expiry, reports and live isolation',async t=>{
 const dir=fs.mkdtempSync(path.join(__dirname,'../tmp/integration-'));
 const service=await createServer({dbPath:path.join(dir,'test.sqlite')});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+service.server.address().port;
 const sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await service.close();});
 const hash=await bcrypt.hash('test-password',4);
 await withWrite(db=>db.run("INSERT INTO users(name,email,password,role,status,must_change_password) VALUES ('Super','super@test.example',?,'superadmin','active',0)",hash));
 const request=async(method,url,token,body,expected=200)=>{
  const res=await fetch(base+'/api'+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=res.headers.get('content-type')?.includes('application/pdf')?Buffer.from(await res.arrayBuffer()):await (async()=>{const text=await res.text();try{return JSON.parse(text);}catch{throw Error(method+' '+url+' '+res.status+' '+text.slice(0,400));}})();
  assert.equal(res.status,expected,method+' '+url+' '+(Buffer.isBuffer(data)?'PDF':JSON.stringify(data)));return data;
 };
 const login=async(email,expected=200)=>{
  const row=await getDB().get('SELECT password FROM users WHERE email=?',email);
  const password=await bcrypt.compare('test-password',row.password)?'test-password':'password123';
  const response=await request('POST','/auth/login',null,{email,password},expected);
  if(response.requiresPasswordChange){
   assert.ok(!response.token);await request('GET','/buses',response.changeToken,null,401);
   await request('POST','/auth/change-initial-password',null,{changeToken:response.changeToken,password:'test-password',confirmPassword:'test-password'});
   return request('POST','/auth/login',null,{email,password:'test-password'},expected);
  }
  return response;
 };
 let root=(await login('super@test.example')).token;
 let a,b,adminA,adminB,studentA,studentB,driverA,driverB,studentToken,driverToken,busA,busB;
 await t.test('every authenticated user can manage their own profile and password',async()=>{
  const oldRoot=root;
  const profile=await request('PUT','/auth/profile',root,{name:'Super Admin',email:'super@test.example',phone:'03001234567'});
  assert.equal(profile.user.name,'Super Admin');assert.equal(profile.user.phone,'03001234567');assert.equal(profile.user.role,'superadmin');
  await request('PUT','/auth/password',root,{currentPassword:'wrong-password',password:'new-profile-password',confirmPassword:'new-profile-password'},400);
  const changed=await request('PUT','/auth/password',root,{currentPassword:'test-password',password:'new-profile-password',confirmPassword:'new-profile-password'});
  assert.ok(changed.token);root=changed.token;
  await request('GET','/auth/me',oldRoot,null,401);
  assert.equal((await request('GET','/auth/me',root)).name,'Super Admin');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const upload=await fetch(base+'/api/auth/avatar',{method:'PUT',headers:{Authorization:'Bearer '+root,'Content-Type':'image/png'},body:png});
  assert.equal(upload.status,200);assert.equal((await upload.json()).user.has_avatar,true);
  const image=await fetch(base+'/api/auth/avatar',{headers:{Authorization:'Bearer '+root}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  await request('DELETE','/auth/avatar',root);assert.equal((await request('GET','/auth/me',root)).has_avatar,false);
 });
 await t.test('only superadmin creates institutes and scoped administrators',async()=>{
  a=(await request('POST','/institutes',root,{name:'Alpha Institute',address:'Alpha Campus'},201)).id;
  b=(await request('POST','/institutes',root,{name:'Beta Institute',address:'Beta Campus'},201)).id;
  for(const [id,email] of [[a,'admin-a@test.example'],[b,'admin-b@test.example']])await request('POST','/auth/admins',root,{name:email,email,password:'test-password',institute_id:id},201);
  adminA=(await login('admin-a@test.example')).token;adminB=(await login('admin-b@test.example')).token;
  await request('POST','/institutes',adminA,{name:'Forbidden'},403);
  await request('POST','/auth/admins',adminA,{name:'Forbidden'},403);
  assert.equal((await request('GET','/institutes',adminA)).length,1);
  await request('GET','/auth/students?institute_id='+b,adminA,null,403);
 });
 await t.test('one admin per institute and mandatory password change cannot be bypassed',async()=>{
  await request('POST','/auth/admins',root,{name:'Duplicate',email:'duplicate@test.example',institute_id:a},409);
  const created=await request('POST','/auth/register-driver',adminA,{name:'First Login',email:'first@test.example',password:'ignored-custom-password'},201);
  await request('POST','/auth/login',null,{email:'first@test.example',password:'ignored-custom-password'},401);
  const first=await request('POST','/auth/login',null,{email:'first@test.example',password:'password123'});
  assert.equal(first.requiresPasswordChange,true);assert.ok(!first.token);
  await request('GET','/auth/me',first.changeToken,null,401);
  await request('POST','/auth/change-initial-password',null,{changeToken:first.changeToken,password:'password123',confirmPassword:'password123'},400);
  await request('POST','/auth/change-initial-password',null,{changeToken:first.changeToken,password:'new-secret-123',confirmPassword:'mismatch'},400);
  await request('POST','/auth/change-initial-password',null,{changeToken:first.changeToken,password:'new-secret-123',confirmPassword:'new-secret-123'});
  await request('POST','/auth/change-initial-password',null,{changeToken:first.changeToken,password:'other-secret-123',confirmPassword:'other-secret-123'},401);
  const signed=await request('POST','/auth/login',null,{email:'first@test.example',password:'new-secret-123'});
  await request('POST','/auth/change-initial-password',null,{changeToken:signed.token,password:'other-secret-123',confirmPassword:'other-secret-123'},401);
  await request('PUT','/auth/drivers/'+created.driverId,adminA,{name:'First Login',email:'first@test.example',password:'reset-password'});
  await request('GET','/auth/me',signed.token,null,401);
  await request('DELETE','/auth/drivers/'+created.driverId,adminA);
  const c=(await request('POST','/institutes',root,{name:'Replacement Institute'},201)).id;
  const old=(await request('POST','/auth/admins',root,{name:'Old Admin',email:'old-admin@test.example',institute_id:c},201)).userId;
  const oldToken=(await login('old-admin@test.example')).token;
  await request('PUT','/auth/admins/'+old,root,{name:'New Admin',email:'new-admin@test.example',replace_admin:true});
  await request('GET','/auth/me',oldToken,null,401);
  await request('POST','/auth/login',null,{email:'old-admin@test.example',password:'test-password'},401);
  const replacement=await request('POST','/auth/login',null,{email:'new-admin@test.example',password:'password123'});
  assert.equal(replacement.requiresPasswordChange,true);
  assert.equal((await getDB().get("SELECT count(*) n FROM users WHERE role='admin' AND institute_id=?",c)).n,1);
 });
 await t.test('institute deletion is superadmin-only and protects linked data; creation requires institute',async()=>{
  const empty=(await request('POST','/institutes',root,{name:'Empty Delete Campus'},201)).id;
  await request('DELETE','/institutes/'+empty,adminA,null,403);
  await request('DELETE','/institutes/'+a,root,null,409);
  await request('DELETE','/institutes/'+empty,root);
  await request('DELETE','/institutes/'+empty,root,null,404);
  for(const [url,body] of [['/auth/students',{name:'Test',email:'test-s@test.example'}],['/auth/register-driver',{name:'Test',email:'test-d@test.example'}],['/routes',{name:'Route',stops:['Gate'],etas:['08:00']}],['/buses',{name:'Bus',number_plate:'TEST-9',route:'Route'}]])await request('POST',url,root,body,400);
 });
 await t.test('signup cannot choose privileged roles; new students require activation',async()=>{
  studentA=(await request('POST','/auth/signup',null,{name:'Alpha Student',email:'student-a@test.example',password:'test-password',institute_id:a,role:'superadmin',status:'active'},201)).userId;
  studentB=(await request('POST','/auth/students',adminB,{name:'Beta Student',email:'student-b@test.example',password:'test-password'},201)).userId;
  const row=await getDB().get('SELECT * FROM users WHERE id=?',studentA);assert.equal(row.role,'student');assert.equal(row.status,'suspended');
  assert.match((await login('student-a@test.example',403)).error,/awaiting payment/);
  const rows=await request('GET','/auth/students',adminA);assert.deepEqual(rows.map(s=>s.id),[studentA]);assert.ok(!('password' in rows[0]));
  assert.equal((await request('GET','/auth/students',root)).length,2);
  for(const [method,suffix,body] of [['PUT','',{name:'Hacked',email:'x@test.example'}],['DELETE',''],['GET','/payments'],['POST','/payments',{amount:1}],['PUT','/access',{status:'suspended'}]])await request(method,'/auth/students/'+studentB+suffix,adminA,body,404);
 });
 await t.test('manual payments validate money/dates and activate an inclusive duration',async()=>{
  const payment={amount:'2500.50',currency:'PKR',access_start:today(),access_end:today(),reference:'ALPHA-001'};
  for(const bad of [{amount:-1},{amount:1.111},{access_start:'2026-02-30'},{access_start:day(2),access_end:today()}])await request('POST','/auth/students/'+studentA+'/payments',adminA,{...payment,...bad},400);
  await request('POST','/auth/students/'+studentA+'/payments',adminA,payment,201);
  const history=await request('GET','/auth/students/'+studentA+'/payments',adminA);assert.equal(history.length,1);assert.equal(history[0].amount_cents,250050);
  studentToken=(await login('student-a@test.example')).token;
  await request('GET','/auth/me',studentToken);
  await request('GET','/auth/students',studentToken,null,403);
  await request('PUT','/auth/students/'+studentB+'/access',root,{status:'active',access_start:today(),access_end:day(30)});
 });
 await t.test('fleet assignments, driver ownership and routes are tenant scoped',async()=>{
  driverA=(await request('POST','/auth/register-driver',adminA,{name:'Alpha Driver',email:'driver-a@test.example',password:'test-password'},201)).driverId;
  driverB=(await request('POST','/auth/register-driver',adminB,{name:'Beta Driver',email:'driver-b@test.example',password:'test-password'},201)).driverId;
  for(const token of [adminA,adminB])await request('POST','/routes',token,{name:'Campus Route',stops:['Gate','Library'],etas:['08:00','08:15']},201);
  const data={name:'Alpha Bus',number_plate:'ALPHA-1',route:'Campus Route',driver_id:driverA};
  await request('POST','/buses',adminA,{...data,number_plate:'BAD-TIME',departure_time:'8:30 AM'},400);
  busA=(await request('POST','/buses',adminA,{...data,departure_time:'08:30'},201)).busId;
  busB=(await request('POST','/buses',adminB,{...data,name:'Beta Bus',number_plate:'BETA-1',driver_id:driverB},201)).busId;
  await request('POST','/buses',adminA,{...data,number_plate:'ALPHA-2',driver_id:driverB},400);
  await request('POST','/buses',adminA,{...data,number_plate:'ALPHA-2'},409);
  assert.deepEqual((await request('GET','/buses',studentToken)).map(v=>v.id),[busA]);
  assert.equal((await request('GET','/routes',studentToken)).length,1);
  await request('GET','/buses?institute_id='+b,studentToken,null,403);
  await request('DELETE','/buses/'+busB,adminA,null,404);
  driverToken=(await login('driver-a@test.example')).token;
  await request('PUT','/buses/'+busB+'/location',driverToken,{lat:0,lng:0},404);
  await request('PUT','/buses/'+busA+'/location',driverToken,{lat:91,lng:0},400);
  await request('PUT','/buses/'+busA+'/stop',driverToken,{stopName:'Wrong stop'},400);
  await request('PUT','/buses/'+busA+'/stop',driverToken,{stopName:'Gate'});
  await request('PUT','/buses/'+busA+'/reset',driverToken,{});
  assert.equal((await request('GET','/buses/my-bus',driverToken)).current_stop,null);
 });
 await t.test('authenticated sockets isolate institutes and revoke suspended access',async()=>{
  const connect=token=>new Promise((resolve,reject)=>{const s=io(base,{auth:{token},transports:['websocket'],reconnection:false,timeout:3000});sockets.push(s);s.once('connect',()=>resolve(s));s.once('connect_error',reject);});
  const sa=await connect(studentToken),sb=await connect(adminB),sr=await connect(root);
  let betaEvents=0;sb.on('locationUpdate',()=>betaEvents++);
  const event=s=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No live event')),3000);s.once('locationUpdate',data=>{clearTimeout(timer);resolve(data);});});
  const pa=event(sa),pr=event(sr);
  await request('PUT','/buses/'+busA+'/location',driverToken,{lat:0,lng:0});
  assert.equal((await pa).id,busA);assert.equal((await pr).id,busA);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(betaEvents,0);
  const disconnected=new Promise(resolve=>sa.once('disconnect',resolve));
  await request('PUT','/auth/students/'+studentA+'/access',adminA,{status:'suspended'});await disconnected;
  assert.match((await login('student-a@test.example',403)).error,/suspended by admin/);
  await request('GET','/buses',studentToken,null,403);
  await request('PUT','/auth/students/'+studentA+'/access',adminA,{status:'active',access_start:today(),access_end:day(30)});
  await assert.rejects(connect('invalid-token'));
 });
 await t.test('expiry applies to existing tokens and future periods remain unavailable',async()=>{
  await withWrite(db=>db.run('UPDATE users SET access_end=? WHERE id=?',day(-1),studentA));
  assert.match((await login('student-a@test.example',403)).error,/expired/);
  await request('GET','/auth/me',studentToken,null,403);
  await expireStudents();assert.equal((await getDB().get('SELECT status FROM users WHERE id=?',studentA)).status,'suspended');
  await request('PUT','/auth/students/'+studentA+'/access',adminA,{status:'active',access_start:day(1),access_end:day(30)});
  assert.match((await login('student-a@test.example',403)).error,/not started/);
  await request('PUT','/auth/students/'+studentA+'/access',adminA,{status:'active',access_start:today(),access_end:day(30)});
 });
 await t.test('PDF reports are protected, valid and handle multiple pages',async()=>{
  await request('GET','/reports/all.pdf',studentToken,null,403);
  await request('GET','/reports/all.pdf?institute_id='+b,adminA,null,403);
  await request('GET','/reports/admins.pdf',adminA,null,403);
  await withWrite(async db=>{for(let n=0;n<55;n++)await db.run("INSERT INTO users(name,email,password,role,institute_id,status,access_start,access_end) VALUES (?,?,?,'student',?,'active',?,?)",'Alpha Long Name Student '+n,'alpha-student-'+n+'@test.example',hash,a,today(),day(30));});
  for(const type of ['all','students','drivers','fleet','routes','payments']){
   const pdf=await request('GET','/reports/'+type+'.pdf',adminA);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;assert.ok(pages<=(type==='all'?15:type==='students'?8:1),'Unexpected blank PDF pages in '+type+': '+pages);fs.writeFileSync(path.join(dir,type+'.pdf'),pdf);
  }
  const filtered=await request('GET','/reports/students.pdf?search=missing&status=active',root);assert.equal(filtered.subarray(0,5).toString(),'%PDF-');
  console.log('PDF validation files: '+dir);
 });
});

test('legacy migration preserves records and is safe to repeat',async()=>{
 const {open}=require('sqlite'),sqlite3=require('sqlite3');
 const {initDB,getJWTSecret}=require('../config/db');
 const dir=fs.mkdtempSync(path.join(__dirname,'../tmp/migration-'));
 const filename=path.join(dir,'legacy.sqlite');
 const old=await open({filename,driver:sqlite3.Database});
 await old.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,password TEXT,role TEXT); CREATE TABLE buses(id INTEGER PRIMARY KEY,name TEXT,number_plate TEXT,driver_id INTEGER,route TEXT,lat REAL,lng REAL,status TEXT); CREATE TABLE routes(id INTEGER PRIMARY KEY,name TEXT,stops TEXT,etas TEXT); INSERT INTO users VALUES(1,'Owner','owner@test.example','hash','admin'),(2,'Existing student','old@test.example','hash','student'); INSERT INTO routes VALUES(1,'Original route','[\"Gate\"]','[\"08:00\"]'); INSERT INTO buses VALUES(1,'Original bus','OLD-1',NULL,'Original route',NULL,NULL,'On time');");
 await old.close();
 let db=await initDB(filename);const secret=getJWTSecret();
 assert.equal((await db.get('SELECT role FROM users WHERE id=1')).role,'superadmin');
 assert.equal((await db.get('SELECT count(*) n FROM users')).n,2);
 assert.equal((await db.get('SELECT route_id FROM buses WHERE id=1')).route_id,1);
 const institute=(await db.get("SELECT id FROM institutes WHERE name='Main Campus'")).id;
 assert.equal((await db.get('SELECT institute_id FROM users WHERE id=2')).institute_id,institute);
 assert.equal((await db.get('SELECT status FROM users WHERE id=2')).status,'active');
 await db.close();db=await initDB(filename);
 assert.equal(getJWTSecret(),secret);assert.equal((await db.get('SELECT count(*) n FROM institutes')).n,1);await db.close();
});
