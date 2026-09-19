const {getDB,withWrite}=require('../config/db');
const {scope,record,text,fail,emit}=require('../lib/access');
async function listBuses(req) {
 const institute=await scope(req);
 return getDB().all('SELECT b.*,u.name AS driver_name,i.name AS institute_name FROM buses b LEFT JOIN users u ON u.id=b.driver_id LEFT JOIN institutes i ON i.id=b.institute_id'+(institute?' WHERE b.institute_id=?':'')+' ORDER BY b.name',...(institute?[institute]:[]));
}
exports.listBuses=listBuses;
exports.getAllBuses=async(req,res)=>res.json(await listBuses(req));
async function save(req,res,editing) {
 const old=editing?await record(req,'buses'):null;
 const institute=old?old.institute_id:await scope(req,true);
 if(req.body.institute_id && Number(req.body.institute_id)!==institute)fail(400,'Bus institute cannot be changed.');
 const name=text(req.body.name,'Bus name'), plate=text(req.body.number_plate,'Plate number',40);
 const route=await getDB().get('SELECT * FROM routes WHERE institute_id=? AND name=?',institute,req.body.route);
 if(!route)fail(400,'Choose a route in the same institute.');
 const driver=req.body.driver_id?Number(req.body.driver_id):null;
 if(driver && !await getDB().get("SELECT id FROM users WHERE id=? AND role='driver' AND institute_id=?",driver,institute))fail(400,'Choose a driver in the same institute.');
 const departure=String(req.body.departure_time||'').trim();
 if(departure&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(departure))fail(400,'Choose a valid departure time.');
 const id=await withWrite(async tx=>{
   if(driver) {
     const assigned=await tx.get('SELECT name FROM buses WHERE driver_id=? AND id!=?',driver,old?.id||0);
     if(assigned&&!req.body.force){const error=Error('Driver already assigned');error.status=409;error.code='DRIVER_ASSIGNED';error.detail='This driver is assigned to '+assigned.name+'. Reassign?';throw error;}
     if(assigned)await tx.run('UPDATE buses SET driver_id=NULL WHERE driver_id=? AND institute_id=?',driver,institute);
   }
   if(old){
     await tx.run('UPDATE buses SET name=?,number_plate=?,driver_id=?,route=?,route_id=?,departure_time=? WHERE id=?',name,plate,driver,route.name,route.id,departure,old.id);
     return old.id;
   }
   return (await tx.run('INSERT INTO buses(name,number_plate,driver_id,route,route_id,departure_time,institute_id,status) VALUES (?,?,?,?,?,?,?,?)',name,plate,driver,route.name,route.id,departure,institute,'On time')).lastID;
 });
 emit(req,institute,'busUpdated',{id});
 res.status(editing?200:201).json({message:'Bus saved.',busId:id});
}
exports.addBus=(req,res)=>save(req,res,false);
exports.updateBus=(req,res)=>save(req,res,true);
async function assigned(req) {
 const bus=await record(req,'buses');
 if(bus.driver_id!==req.userId)fail(403,'This bus is not assigned to you.');
 return bus;
}
exports.updateBusLocation=async(req,res)=>{
 const bus=await assigned(req); const {lat,lng}=req.body;
 if(typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail(400,'Invalid coordinates.');
 await withWrite(tx=>tx.run('UPDATE buses SET lat=?,lng=? WHERE id=?',lat,lng,bus.id));
 emit(req,bus.institute_id,'locationUpdate',{id:bus.id,lat,lng});
 res.json({message:'Location updated.'});
};
exports.updateBusStatus=async(req,res)=>{
 const bus=await assigned(req);const status=text(req.body.status,'Status',240);
 await withWrite(tx=>tx.run('UPDATE buses SET status=? WHERE id=?',status,bus.id));
 emit(req,bus.institute_id,'statusUpdate',{id:bus.id,status});res.json({message:'Status updated.'});
};
exports.updateBusStop=async(req,res)=>{
 const bus=await assigned(req);const stop=text(req.body.stopName,'Stop',160);
 const route=await getDB().get('SELECT stops FROM routes WHERE id=? AND institute_id=?',bus.route_id,bus.institute_id);
 if(!route||!JSON.parse(route.stops).includes(stop))fail(400,'Stop is not on this bus route.');
 await withWrite(tx=>tx.run('UPDATE buses SET current_stop=? WHERE id=?',stop,bus.id));
 emit(req,bus.institute_id,'stopUpdate',{id:bus.id,current_stop:stop});res.json({message:'Stop updated.'});
};
exports.deleteBus=async(req,res)=>{
 const bus=await record(req,'buses');await withWrite(tx=>tx.run('DELETE FROM buses WHERE id=?',bus.id));
 emit(req,bus.institute_id,'busUpdated',{id:bus.id});res.json({message:'Bus deleted.'});
};
exports.getMyBus=async(req,res)=>{
 const bus=await getDB().get('SELECT * FROM buses WHERE driver_id=? AND institute_id=?',req.userId,req.user.institute_id);
 if(!bus)fail(404,'No bus assigned yet. Please contact your institute admin.');res.json(bus);
};
exports.getAnalytics=async(req,res)=>{
 const institute=await scope(req);
 const filter=institute?' AND institute_id=?':'';
 const args=institute?[institute]:[];
 const count=async(table,condition)=>(await getDB().get('SELECT COUNT(*) AS n FROM '+table+' WHERE '+condition+filter,...args)).n;
 res.json({
  totalBuses:await count('buses','1=1'),
  activeBuses:await count('buses',"(status LIKE 'Moving%' OR status LIKE 'Arrived%' OR status='On time')"),
  totalDrivers:await count('users',"role='driver'"), totalStudents:await count('users',"role='student'")
 });
};

exports.resetTrip=async(req,res)=>{
 const bus=await assigned(req);
 await withWrite(tx=>tx.run("UPDATE buses SET status='On time',current_stop=NULL WHERE id=?",bus.id));
 emit(req,bus.institute_id,'busUpdated',{id:bus.id});
 res.json({message:'Trip reset.'});
};
