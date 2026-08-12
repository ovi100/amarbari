import { Router } from 'express';
import { Role } from '@prisma/client';
import * as tickets from '../controllers/ticket.controller';
import { requireApprovedTenant, requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { ticketImageUpload } from '../middlewares/upload';
import {
  createTicketSchema,
  idParamSchema,
  ticketFilterSchema,
  updateTicketSchema,
} from '../utils/validators';

const router = Router();

router.use(requireAuth);

router.post(
  '/',
  requireApprovedTenant,
  ticketImageUpload,
  validate(createTicketSchema),
  tickets.createTicket
);
router.get('/', validate(ticketFilterSchema, 'query'), tickets.listTickets);
router.get('/:id', validate(idParamSchema, 'params'), tickets.getTicket);
router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate(idParamSchema, 'params'),
  validate(updateTicketSchema),
  tickets.updateTicketStatus
);

export default router;
