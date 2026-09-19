const express=require('express');
const c=require('../controllers/authController');
const {verifyToken,isAdmin,isSuperAdmin}=require('../middleware/authMiddleware');
const router=express.Router();
router.post('/change-initial-password',c.changeInitialPassword);
router.post('/signup',c.signup); router.post('/login',c.login);
router.get('/me',verifyToken,c.me);
router.post('/register-driver',verifyToken,isAdmin,c.registerDriver);
router.post('/students',verifyToken,isAdmin,c.registerStudent);
for(const [path,list,update,remove] of [
 ['students',c.getAllStudents,c.updateStudent,c.deleteStudent],['drivers',c.getAllDrivers,c.updateDriver,c.deleteDriver]
]) { router.get('/'+path,verifyToken,isAdmin,list); router.put('/'+path+'/:id',verifyToken,isAdmin,update); router.delete('/'+path+'/:id',verifyToken,isAdmin,remove); }
router.put('/students/:id/access',verifyToken,isAdmin,c.setAccess);
router.post('/students/:id/payments',verifyToken,isAdmin,c.recordPayment);
router.get('/students/:id/payments',verifyToken,isAdmin,c.paymentHistory);
router.get('/admins',verifyToken,isSuperAdmin,c.getAllAdmins);
router.post('/admins',verifyToken,isSuperAdmin,c.registerAdmin);
router.put('/admins/:id',verifyToken,isSuperAdmin,c.updateAdmin);
router.delete('/admins/:id',verifyToken,isSuperAdmin,c.deleteAdmin);
module.exports=router;
