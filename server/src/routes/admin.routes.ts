import { Router } from 'express';
import { Role } from '@prisma/client';
import * as admin from '../controllers/admin.controller';
import * as meters from '../controllers/meter.controller';
import { requireAuth, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import {
  activityQuerySchema,
  addColumnSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  analyticsRangeSchema,
  approvalSchema,
  assignFlatSchema,
  assignMeterSchema,
  electricityQuerySchema,
  expenseSchema,
  exportQuerySchema,
  flatSchema,
  idParamSchema,
  listQuerySchema,
  meterListQuerySchema,
  meterSchema,
  shopSchema,
  tableQuerySchema,
  tenancySchema,
  updateFlatSchema,
  updateMeterSchema,
  updateShopSchema,
  updateTenancySchema,
  userListQuerySchema,
} from '../utils/validators';

const router = Router();

// Every admin route is gated: authenticate, then hard-fail non-admins with 403.
router.use(requireAuth, requireRole(Role.ADMIN));

// --- Users -----------------------------------------------------------------
// `/tenants` is kept as an alias so existing integrations keep working; the
// product now calls these accounts "users".
for (const base of ['/users', '/tenants']) {
  router.get(base, validate(userListQuerySchema.passthrough(), 'query'), admin.listUsers);
  router.post(base, validate(adminCreateUserSchema), admin.createUser);
  router.get(`${base}/:id`, validate(idParamSchema, 'params'), admin.getUser);
  router.patch(
    `${base}/:id`,
    validate(idParamSchema, 'params'),
    validate(adminUpdateUserSchema),
    admin.updateUser
  );
  router.patch(
    `${base}/:id/approval`,
    validate(idParamSchema, 'params'),
    validate(approvalSchema),
    admin.setApproval
  );
  router.delete(`${base}/:id`, validate(idParamSchema, 'params'), admin.deleteUser);
}

// --- Flats -----------------------------------------------------------------
router.get('/flats', admin.listFlats);
router.post('/flats', validate(flatSchema), admin.createFlat);
router.patch(
  '/flats/:id',
  validate(idParamSchema, 'params'),
  validate(updateFlatSchema),
  admin.updateFlat
);
router.post(
  '/flats/:id/tenancy',
  validate(idParamSchema, 'params'),
  validate(assignFlatSchema),
  admin.assignFlat
);
router.delete('/flats/:id/tenancy', validate(idParamSchema, 'params'), admin.releaseFlat);
router.delete('/flats/:id', validate(idParamSchema, 'params'), admin.deleteFlat);

// --- Shops -----------------------------------------------------------------
// Mirrors the flat routes: a shop is the other rent category, with the same
// one-user-per-unit invariant (which spans both tables).
router.get('/shops', admin.listShops);
router.post('/shops', validate(shopSchema), admin.createShop);
router.patch(
  '/shops/:id',
  validate(idParamSchema, 'params'),
  validate(updateShopSchema),
  admin.updateShop
);
router.post(
  '/shops/:id/tenancy',
  validate(idParamSchema, 'params'),
  validate(assignFlatSchema),
  admin.assignShop
);
router.delete('/shops/:id/tenancy', validate(idParamSchema, 'params'), admin.releaseShop);
router.delete('/shops/:id', validate(idParamSchema, 'params'), admin.deleteShop);

// --- Meters ----------------------------------------------------------------
// Management is admin-only; residents file readings through /meters (see
// meter.routes.ts), which is mounted for both roles.
router.get('/meters/summary', meters.summary);
router.get('/meters/electricity', validate(electricityQuerySchema, 'query'), meters.electricity);
router.get('/meters', validate(meterListQuerySchema, 'query'), meters.list);
router.post('/meters', validate(meterSchema), meters.create);
router.patch(
  '/meters/:id',
  validate(idParamSchema, 'params'),
  validate(updateMeterSchema),
  meters.update
);
router.post(
  '/meters/:id/assign',
  validate(idParamSchema, 'params'),
  validate(assignMeterSchema),
  meters.assign
);
router.delete('/meters/:id/assign', validate(idParamSchema, 'params'), meters.unassign);
router.delete('/meters/:id', validate(idParamSchema, 'params'), meters.remove);

// --- Activity log ----------------------------------------------------------
router.get('/activity', validate(activityQuerySchema, 'query'), admin.listActivityLog);

// --- Tenancies -------------------------------------------------------------
router.post('/tenancies', validate(tenancySchema), admin.createTenancy);
router.patch(
  '/tenancies/:id',
  validate(idParamSchema, 'params'),
  validate(updateTenancySchema),
  admin.updateTenancy
);

// --- Expenses --------------------------------------------------------------
router.get('/expenses', validate(listQuerySchema, 'query'), admin.listExpenses);
router.post('/expenses', validate(expenseSchema), admin.createExpense);
router.patch(
  '/expenses/:id',
  validate(idParamSchema, 'params'),
  validate(expenseSchema.partial()),
  admin.updateExpense
);
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
