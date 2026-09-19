const express=require('express');
const {getDB,withWrite}=require('../config/db');
const {verifyToken,isAdmin,isSuperAdmin}=require('../middleware/authMiddleware');
const {scope,text,fail}=require('../lib/access');
const router=express.Router();
router.get('/public',async(req,res)=>res.json(await getDB().all('SELECT id,name FROM institutes ORDER BY name')));
router.get('/',verifyToken,isAdmin,async(req,res)=>{
 const institute=req.userRole==='superadmin'?null:await scope(req);
 res.json(await getDB().all('SELECT * FROM institutes'+(institute?' WHERE id=?':'')+' ORDER BY name',...(institute?[institute]:[])));
});
router.post('/',verifyToken,isSuperAdmin,async(req,res)=>{
 const name=text(req.body.name,'Institute name');
 const result=await withWrite(tx=>tx.run('INSERT INTO institutes(name,address) VALUES (?,?)',name,String(req.body.address||'').slice(0,300)));
 res.status(201).json({id:result.lastID,name});
});
router.put('/:id',verifyToken,isSuperAdmin,async(req,res)=>{
 const name=text(req.body.name,'Institute name');
 const result=await withWrite(tx=>tx.run('UPDATE institutes SET name=?,address=? WHERE id=?',name,String(req.body.address||'').slice(0,300),req.params.id));
 if(!result.changes)return res.status(404).json({error:'Institute not found.'});
 res.json({message:'Institute updated.'});
});
router.delete('/:id',verifyToken,isSuperAdmin,async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isInteger(id)||id<=0)fail(400,'Invalid institute.');
 await withWrite(async tx=>{
  if(!await tx.get('SELECT id FROM institutes WHERE id=?',id))fail(404,'Institute not found.');
  const counts=await tx.get('SELECT (SELECT count(*) FROM users WHERE institute_id=?) users,(SELECT count(*) FROM buses WHERE institute_id=?) buses,(SELECT count(*) FROM routes WHERE institute_id=?) routes,(SELECT count(*) FROM payments WHERE institute_id=?) payments',id,id,id,id);
  if(Object.values(counts).some(count=>count>0))fail(409,'This institute still has accounts, buses, routes or payment records. Remove linked records before deleting it; payment history is retained.');
  await tx.run('DELETE FROM institutes WHERE id=?',id);
 });
 res.json({message:'Institute deleted.'});
});
module.exports=router;
