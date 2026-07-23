const express = require('express');
const { 
  signup, login, registerDriver, getAllDrivers, updateDriver, deleteDriver,
  getAllStudents, updateStudent, deleteStudent 
} = require('../controllers/authController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/register-driver', verifyToken, isAdmin, registerDriver);
router.get('/drivers', verifyToken, isAdmin, getAllDrivers);
router.put('/drivers/:id', verifyToken, isAdmin, updateDriver);
router.delete('/drivers/:id', verifyToken, isAdmin, deleteDriver);

// Student Management
router.get('/students', verifyToken, isAdmin, getAllStudents);
router.put('/students/:id', verifyToken, isAdmin, updateStudent);
router.delete('/students/:id', verifyToken, isAdmin, deleteStudent);

module.exports = router;
