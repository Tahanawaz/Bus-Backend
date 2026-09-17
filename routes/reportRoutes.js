const express=require('express');
const PDFDocument=require('pdfkit');
const fs=require('fs');
const {getDB}=require('../config/db');
const {verifyToken,isAdmin}=require('../middleware/authMiddleware');
const {scope,fail,publicUser}=require('../lib/access');
const {listBuses}=require('../controllers/busController');
const {listRoutes}=require('../controllers/routeController');
const router=express.Router();
router.get('/:type.pdf',verifyToken,isAdmin,async(req,res)=>{
 const institute=await scope(req);
 const type=req.params.type;
 if(!['all','students','drivers','fleet','routes','payments','institutes','admins'].includes(type))fail(400,'Unknown report.');
 if(['institutes','admins'].includes(type)&&req.userRole!=='superadmin')fail(403,'Super admin access required.');
 const label=institute?(await getDB().get('SELECT name FROM institutes WHERE id=?',institute)).name:'All institutes';
 const tables=[];
 const add=(title,headers,rows)=>tables.push({title,headers,rows});
 for(const role of ['student','driver','admin']){
  const key=role==='student'?'students':role==='driver'?'drivers':'admins';
  if(type!==key&&!(type==='all'&&(role!=='admin'||req.userRole==='superadmin')))continue;
  let rows=await getDB().all('SELECT u.*,i.name AS institute_name FROM users u LEFT JOIN institutes i ON i.id=u.institute_id WHERE u.role=?'+(institute?' AND u.institute_id=?':'')+' ORDER BY i.name,u.name',role,...(institute?[institute]:[]));
  if(req.query.search)rows=rows.filter(u=>(u.name+' '+u.email).toLowerCase().includes(String(req.query.search).toLowerCase()));
  rows=rows.map(publicUser);
  if(req.query.status)rows=rows.filter(u=>u.status===req.query.status);
  add(key.toUpperCase(),['Name','Email','Institute',...(role==='student'?['Status','Start','End']:['Phone'])],
   rows.map(u=>[u.name,u.email,u.institute_name,...(role==='student'?[u.status,u.access_start||'Not set',u.access_end||'Not set']:[u.phone||'-'])]));
 }
 if(type==='all'||type==='fleet')add('BUS FLEET',['Bus','Plate','Institute','Driver','Route','Status'],(await listBuses(req)).map(b=>[b.name,b.number_plate,b.institute_name,b.driver_name||'Unassigned',b.route||'Unassigned',b.status]));
 if(type==='all'||type==='routes'){
  const rows=await listRoutes(req);const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
  add('ROUTES & STOPS',['Route','Institute','Stop #','Stop','Scheduled time'],unique.flatMap(r=>JSON.parse(r.stops).map((stop,index)=>[r.name,r.institute_name,index+1,stop,JSON.parse(r.etas)[index]||'-'])));
 }
 if(type==='all'||type==='payments'){
  const rows=await getDB().all('SELECT p.*,u.name AS student_name,i.name AS institute_name FROM payments p LEFT JOIN users u ON u.id=p.student_id JOIN institutes i ON i.id=p.institute_id'+(institute?' WHERE p.institute_id=?':'')+' ORDER BY p.id DESC',...(institute?[institute]:[]));
  add('PAYMENT RECORDS',['Student','Institute','Amount','Period','Reference','Recorded (UTC)'],rows.map(p=>[p.student_name||'Deleted student',p.institute_name,(p.amount_cents/100).toFixed(2)+' '+p.currency,p.access_start+' to '+p.access_end,p.reference||'-',p.recorded_at]));
 }
 if((type==='all'||type==='institutes')&&req.userRole==='superadmin')add('INSTITUTES',['Name','Address','Created (UTC)'],(await getDB().all('SELECT * FROM institutes'+(institute?' WHERE id=?':'')+' ORDER BY name',...(institute?[institute]:[]))).map(i=>[i.name,i.address||'-',i.created_at]));
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:38,bufferPages:true,info:{Title:'SmartBus - '+type+' report',Author:'SmartBus'}});
 const font=process.env.PDF_FONT_PATH || (fs.existsSync('C:/Windows/Fonts/arial.ttf')?'C:/Windows/Fonts/arial.ttf':null);
 if(font)doc.font(font);
 res.setHeader('Content-Type','application/pdf');
 res.setHeader('Content-Disposition','attachment; filename="smartbus-'+type+'-'+new Date().toISOString().slice(0,10)+'.pdf"');
 doc.pipe(res);
 const width=doc.page.width-76;const bottom=doc.page.height-68;
 let y=0;
 const pageHeader=(title)=>{
  doc.rect(0,0,doc.page.width,8).fill('#2865e8');
  doc.fillColor('#182b49').fontSize(22).text('SmartBus',38,29);
  doc.fontSize(9).fillColor('#718098').text('CAMPUS OPERATIONS REPORT',38,56);
  doc.fontSize(10).fillColor('#182b49').text(label,300,32,{width:width-262,height:26,ellipsis:true,align:'right'});
  doc.fontSize(8).fillColor('#718098').text('Generated '+new Date().toISOString().replace('T',' ').slice(0,19)+' UTC',300,65,{width:width-262,align:'right'});
  doc.fillColor('#182b49').fontSize(14).text(title,38,87);y=114;
 };
 tables.forEach((table,index)=>{
  if(index)doc.addPage();
  pageHeader(table.title+'  /  '+table.rows.length+' records');
  const col=width/table.headers.length;
  const columns=()=>{
   doc.rect(38,y,width,27).fill('#eaf1ff');
   table.headers.forEach((h,i)=>doc.fontSize(9).fillColor('#284e85').text(h,46+i*col,y+8,{width:col-16}));
   y+=27;
  };
  columns();
  if(!table.rows.length){doc.fontSize(10).fillColor('#718098').text('No records match this report.',46,y+20);return;}
  table.rows.forEach((row,n)=>{
   const strings=row.map(v=>String(v??'-').replace(/[\r\n]+/g,' '));
   doc.fontSize(9);
   const height=Math.max(32,...strings.map(v=>doc.heightOfString(v,{width:col-16})+18));
   if(y+height>bottom){doc.addPage();pageHeader(table.title+' (continued)');columns();}
   doc.rect(38,y,width,height).fill(n%2?'#f5f7fb':'#ffffff');
   strings.forEach((v,i)=>doc.fillColor('#263a55').fontSize(9).text(v,46+i*col,y+9,{width:col-16}));
   y+=height;doc.moveTo(38,y).lineTo(38+width,y).strokeColor('#e5eaf2').stroke();
  });
 });
 const range=doc.bufferedPageRange();
 for(let i=0;i<range.count;i++){
  doc.switchToPage(i);doc.fontSize(8).fillColor('#718098').text('SmartBus | '+label,38,doc.page.height-50,{width:width-80,lineBreak:false});
  doc.text((i+1)+' / '+range.count,doc.page.width-100,doc.page.height-50,{width:62,align:'right',lineBreak:false});
 }
 doc.end();
});
module.exports=router;
