import { Router } from 'express';
import { Role } from '@prisma/client';
import * as invoices from '../controllers/invoice.controller';
import { requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import {
  generateInvoiceSchema,
  idParamSchema,
  paginationSchema,
  recordPaymentSchema,
} from '../utils/validators';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  requireRole(Role.ADMIN),
  validate(paginationSchema, 'query'),
  invoices.listInvoices
);
router.post(
  '/',
  requireRole(Role.ADMIN),
  validate(generateInvoiceSchema),
  invoices.createInvoice
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
