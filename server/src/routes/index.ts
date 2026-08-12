import { Router } from 'express';
import authRoutes from './auth.routes';
import rentRoutes from './rent.routes';
import ticketRoutes from './ticket.routes';
import invoiceRoutes from './invoice.routes';
import adminRoutes from './admin.routes';
import chatRoutes from './chat.routes';
import { getStoreMode } from '../utils/keyValueStore';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: { status: 'ok', uptime: process.uptime(), cache: getStoreMode() },
  });
});

router.use('/auth', authRoutes);
router.use('/rent', rentRoutes);
router.use('/tickets', ticketRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/admin', adminRoutes);
router.use('/chat', chatRoutes);

export default router;
