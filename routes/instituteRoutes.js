const express=require('express');
const {getDB,withWrite}=require('../config/db');
const {verifyToken,isAdmin,isSuperAdmin}=require('../middleware/authMiddleware');
const {scope,text}=require('../lib/access');
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
module.exports=router;
