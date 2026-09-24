const express = require('express');
const controller = require('../controllers/contactController');
const { verifyToken, isSuperAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/', controller.create);
router.get('/', verifyToken, isSuperAdmin, controller.list);
router.put('/read-all', verifyToken, isSuperAdmin, controller.markAllRead);
router.put('/:id/status', verifyToken, isSuperAdmin, controller.setStatus);
router.delete('/:id', verifyToken, isSuperAdmin, controller.remove);

module.exports = router;
