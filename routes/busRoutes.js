const express = require('express');
const { getAllBuses, getMyBus, addBus, updateBus, updateBusLocation, updateBusStatus, updateBusStop, deleteBus, getAnalytics } = require('../controllers/busController');
const { verifyToken, isAdmin, isDriver } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/', verifyToken, getAllBuses);
router.get('/my-bus', verifyToken, isDriver, getMyBus);
router.get('/analytics', verifyToken, isAdmin, getAnalytics);
router.post('/', verifyToken, isAdmin, addBus);
router.put('/:id', verifyToken, isAdmin, updateBus);
router.put('/:id/location', verifyToken, isDriver, updateBusLocation);
router.put('/:id/status', verifyToken, isDriver, updateBusStatus);
router.put('/:id/stop', verifyToken, isDriver, updateBusStop);
router.delete('/:id', verifyToken, isAdmin, deleteBus);

module.exports = router;
