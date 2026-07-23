const express = require('express');
const { getAllRoutes, addRoute, updateRoute, deleteRoute } = require('../controllers/routeController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/', verifyToken, getAllRoutes);
router.post('/', verifyToken, isAdmin, addRoute);
router.put('/:id', verifyToken, isAdmin, updateRoute);
router.delete('/:id', verifyToken, isAdmin, deleteRoute);

module.exports = router;
