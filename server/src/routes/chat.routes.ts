import { Router } from 'express';
import { Role } from '@prisma/client';
import * as chat from '../controllers/chat.controller';
import { requireApprovedTenant, requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { sendMessageSchema } from '../utils/validators';

const router = Router();

router.use(requireAuth, requireApprovedTenant);

router.get('/conversations', requireRole(Role.ADMIN), chat.listConversations);
router.get('/thread', chat.getThread);
router.get('/thread/:partnerId', chat.getThread);
router.post('/messages', validate(sendMessageSchema.partial({ receiverId: true })), chat.postMessage);

export default router;
