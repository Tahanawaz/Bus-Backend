const express = require('express');
const controller = require('../controllers/policyController');
const { verifyToken, isSuperAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/', controller.list);
router.get('/:type/pdf', controller.pdf);
router.put('/:type', verifyToken, isSuperAdmin, express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '10mb' }), controller.upload);
router.delete('/:type', verifyToken, isSuperAdmin, controller.remove);

module.exports = router;
