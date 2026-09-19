require('dotenv').config();
const express=require('express');
const cors=require('cors');
const http=require('http');
const {Server}=require('socket.io');
const {initDB,getDB}=require('./config/db');
const {authenticate}=require('./middleware/authMiddleware');
const {expireStudents,accessMessage}=require('./lib/access');
async function createServer(options={}) {
 await initDB(options.dbPath);
 await expireStudents();
 const app=express();const server=http.createServer(app);
 const io=new Server(server,{cors:{origin:process.env.CLIENT_ORIGIN || '*'}});
 app.use(cors());app.use(express.json({limit:'256kb'}));
 app.use((req,res,next)=>{req.io=io;next();});
 app.get('/api/health',(req,res)=>res.json({status:'OK',timestamp:new Date().toISOString()}));
 app.use('/api/auth',require('./routes/authRoutes'));
 app.use('/api/institutes',require('./routes/instituteRoutes'));
 app.use('/api/buses',require('./routes/busRoutes'));
 app.use('/api/routes',require('./routes/routeRoutes'));
 app.use('/api/reports',require('./routes/reportRoutes'));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const constraint=String(err.code||'').startsWith('SQLITE_CONSTRAINT');
  const status=err.status || (constraint?409:500);
  if(status===500)console.error(err);
  res.status(status).json({error:status===500?'Unable to complete request.':constraint?'This email, plate, or name is already in use.':err.message,code:err.code,message:err.detail||err.message});
 });
 io.use(async(socket,next)=>{
  try{socket.data.user=await authenticate(socket.handshake.auth?.token);next();}
  catch(err){const error=Error(err.message);error.data={code:err.code};next(error);}
 });
 io.on('connection',socket=>{
  const user=socket.data.user;socket.join('user:'+user.id);
  socket.join(user.role==='superadmin'?'superadmin':'institute:'+user.institute_id);
 });
 const timer=setInterval(async()=>{
  try {
   await expireStudents();
   for(const socket of io.sockets.sockets.values()){
    const u=await getDB().get('SELECT * FROM users WHERE id=?',socket.data.user.id);
    if(!u||u.must_change_password||u.token_version!==socket.data.user.token_version||accessMessage(u))socket.disconnect(true);
   }
  }catch(err){console.error('Access maintenance failed:',err.message);}
 },30000);timer.unref();
 return {app,server,io,close:async()=>{clearInterval(timer);await new Promise(resolve=>io.close(resolve));await getDB().close();}};
}
if(require.main===module)createServer().then(({server})=>server.listen(process.env.PORT||5001,()=>console.log('SmartBus API ready on '+(process.env.PORT||5001)))).catch(err=>{console.error(err);process.exitCode=1;});
module.exports={createServer};
