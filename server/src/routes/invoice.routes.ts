import { Router } from 'express';
import { Role } from '@prisma/client';
import * as invoices from '../controllers/invoice.controller';
import { requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import {
  generateInvoiceSchema,
  idParamSchema,
  listQuerySchema,
  recordPaymentSchema,
  updateInvoiceSchema,
} from '../utils/validators';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  requireRole(Role.ADMIN),
  validate(listQuerySchema, 'query'),
  invoices.listInvoices
);
router.post(
  '/',
  requireRole(Role.ADMIN),
  validate(generateInvoiceSchema),
  invoices.createInvoice
);
router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate(idParamSchema, 'params'),
  validate(updateInvoiceSchema),
  invoices.editInvoice
);
router.post(
  '/:id/payments',
  requireRole(Role.ADMIN),
  validate(idParamSchema, 'params'),
  validate(recordPaymentSchema),
  invoices.payInvoice
);

router.get('/:id', validate(idParamSchema, 'params'), invoices.getInvoice);
router.get('/:id/pdf', validate(idParamSchema, 'params'), invoices.downloadPdf);
router.get('/:id/jpg', validate(idParamSchema, 'params'), invoices.downloadJpg);

export default router;
