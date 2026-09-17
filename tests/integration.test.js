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
 await withWrite(db=>db.run("INSERT INTO users(name,email,password,role,status) VALUES ('Super','super@test.example',?,'superadmin','active')",hash));
 const request=async(method,url,token,body,expected=200)=>{
  const res=await fetch(base+'/api'+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=res.headers.get('content-type')?.includes('application/pdf')?Buffer.from(await res.arrayBuffer()):await res.json();
  assert.equal(res.status,expected,method+' '+url+' '+(Buffer.isBuffer(data)?'PDF':JSON.stringify(data)));return data;
 };
 const login=(email,expected=200)=>request('POST','/auth/login',null,{email,password:'test-password'},expected);
 const root=(await login('super@test.example')).token;
 let a,b,adminA,adminB,studentA,studentB,driverA,driverB,studentToken,driverToken,busA,busB;
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
  busA=(await request('POST','/buses',adminA,data,201)).busId;
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
