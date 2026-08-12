import { Router } from 'express';
import { Role } from '@prisma/client';
import * as admin from '../controllers/admin.controller';
import { requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import {
  addColumnSchema,
  analyticsRangeSchema,
  approvalSchema,
  expenseSchema,
  exportQuerySchema,
  flatSchema,
  idParamSchema,
  paginationSchema,
  tableQuerySchema,
  tenancySchema,
  updateFlatSchema,
  updateTenancySchema,
} from '../utils/validators';

const router = Router();

// Every admin route is gated: authenticate, then hard-fail non-admins with 403.
router.use(requireAuth, requireRole(Role.ADMIN));

// --- Tenants ---------------------------------------------------------------
router.get('/tenants', validate(paginationSchema.passthrough(), 'query'), admin.listTenants);
router.get('/tenants/:id', validate(idParamSchema, 'params'), admin.getTenant);
router.patch(
  '/tenants/:id/approval',
  validate(idParamSchema, 'params'),
  validate(approvalSchema),
  admin.setApproval
);
router.delete('/tenants/:id', validate(idParamSchema, 'params'), admin.deleteTenant);

// --- Flats -----------------------------------------------------------------
router.get('/flats', admin.listFlats);
router.post('/flats', validate(flatSchema), admin.createFlat);
router.patch(
  '/flats/:id',
  validate(idParamSchema, 'params'),
  validate(updateFlatSchema),
  admin.updateFlat
);
router.delete('/flats/:id', validate(idParamSchema, 'params'), admin.deleteFlat);

// --- Tenancies -------------------------------------------------------------
router.post('/tenancies', validate(tenancySchema), admin.createTenancy);
router.patch(
  '/tenancies/:id',
  validate(idParamSchema, 'params'),
  validate(updateTenancySchema),
  admin.updateTenancy
);

// --- Expenses --------------------------------------------------------------
router.get('/expenses', validate(paginationSchema, 'query'), admin.listExpenses);
router.post('/expenses', validate(expenseSchema), admin.createExpense);
router.delete('/expenses/:id', validate(idParamSchema, 'params'), admin.deleteExpense);

// --- Analytics & export ----------------------------------------------------
router.get('/analytics/export', validate(exportQuerySchema, 'query'), admin.exportAnalytics);
router.get('/analytics', validate(analyticsRangeSchema, 'query'), admin.analytics);

// --- Dynamic schema management ---------------------------------------------
router.get('/tables', admin.getTables);
router.get('/tables/:tableName/schema', admin.getTableSchema);
router.get('/tables/:tableName', validate(tableQuerySchema, 'query'), admin.getTable);
router.post('/tables/:tableName/columns', validate(addColumnSchema), admin.addTableColumn);
router.delete('/tables/:tableName/columns/:columnName', admin.removeTableColumn);
router.patch('/tables/:tableName/records/:id', admin.patchTableRecord);
router.delete('/tables/:tableName/records/:id', admin.deleteTableRecord);

export default router;
