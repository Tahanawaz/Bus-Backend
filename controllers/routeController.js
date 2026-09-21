const {getDB,withWrite}=require('../config/db');
const {scope,record,text,fail,emit}=require('../lib/access');
async function listRoutes(req) {
 const institute=await scope(req);
 return getDB().all(`SELECT r.*, i.name AS institute_name,b.id AS bus_id,b.name AS bus_name,b.number_plate AS bus_plate,b.lat,b.lng,u.name AS driver_name
 FROM routes r LEFT JOIN institutes i ON i.id=r.institute_id LEFT JOIN buses b ON b.route_id=r.id AND b.institute_id=r.institute_id LEFT JOIN users u ON u.id=b.driver_id`+(institute?' WHERE r.institute_id=?':'')+' ORDER BY r.name,b.name',...(institute?[institute]:[]));
}
exports.listRoutes=listRoutes;
exports.getAllRoutes=async(req,res)=>res.json(await listRoutes(req));
async function save(req,res,editing) {
 const old=editing?await record(req,'routes'):null;
 const institute=old?old.institute_id:await scope(req,true);
 const name=text(req.body.name,'Route name');
 const {stops,etas,stop_coordinates}=req.body;
 if(!Array.isArray(stops)||!stops.length||stops.length>100||!Array.isArray(etas)||etas.length!==stops.length)fail(400,'Provide 1-100 stops and one timing for each stop.');
 if(!Array.isArray(stop_coordinates)||stop_coordinates.length!==stops.length)fail(400,'Provide one latitude and longitude pair for each stop.');
 const cleanStops=stops.map(s=>text(s,'Stop',160)), cleanEtas=etas.map(s=>text(s,'Timing',80));
 const cleanCoordinates=stop_coordinates.map((point,index)=>{
  const lat=Number(Array.isArray(point)?point[0]:point?.lat),lng=Number(Array.isArray(point)?point[1]:point?.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail(400,'Invalid coordinates for stop '+(index+1)+'. Latitude must be -90 to 90 and longitude -180 to 180.');
  return {lat,lng};
 });
 const duplicate=await getDB().get('SELECT id FROM routes WHERE institute_id=? AND name=? AND id!=?',institute,name,old?.id||0);
 if(duplicate)fail(409,'Route name already exists in this institute.');
 const id=await withWrite(async tx=>{
  if(old){
   await tx.run('UPDATE routes SET name=?,stops=?,etas=?,stop_coordinates=? WHERE id=?',name,JSON.stringify(cleanStops),JSON.stringify(cleanEtas),JSON.stringify(cleanCoordinates),old.id);
   await tx.run('UPDATE buses SET route=? WHERE route_id=?',name,old.id);return old.id;
  }
  return (await tx.run('INSERT INTO routes(name,stops,etas,stop_coordinates,institute_id) VALUES (?,?,?,?,?)',name,JSON.stringify(cleanStops),JSON.stringify(cleanEtas),JSON.stringify(cleanCoordinates),institute)).lastID;
 });
 emit(req,institute,'busUpdated',{route_id:id});res.status(editing?200:201).json({message:'Route saved.',routeId:id,mappedStops:cleanCoordinates.length});
}
exports.addRoute=(req,res)=>save(req,res,false);
exports.updateRoute=(req,res)=>save(req,res,true);
exports.deleteRoute=async(req,res)=>{
 const route=await record(req,'routes');
 await withWrite(async tx=>{await tx.run('UPDATE buses SET route=NULL,route_id=NULL,current_stop=NULL WHERE route_id=?',route.id);await tx.run('DELETE FROM routes WHERE id=?',route.id);});
 emit(req,route.institute_id,'busUpdated',{route_id:route.id});res.json({message:'Route deleted.'});
};
