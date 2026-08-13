import { Router } from 'express';
import * as meters from '../controllers/meter.controller';
import { requireApprovedTenant, requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParamSchema, meterReadingSchema, meterReportQuerySchema } from '../utils/validators';

/**
 * Meter routes shared by both roles (SRS 6.7).
 *
 * Admin-only management — create, edit, delete, assign — lives under
 * `/admin/meters`. What is here is what a resident also needs: their own
 * meters, filing a reading, and the consumption report. The per-record
 * ownership check is in the controller, since it depends on the meter's unit.
 */
const router = Router();

router.use(requireAuth, requireApprovedTenant);

router.get('/my', meters.mine);
router.get('/:id', validate(idParamSchema, 'params'), meters.detail);
router.get('/:id/readings', validate(idParamSchema, 'params'), meters.readings);
router.post(
  '/:id/readings',
  validate(idParamSchema, 'params'),
  validate(meterReadingSchema),
  meters.submitReading
);
router.get(
  '/:id/report',
  validate(idParamSchema, 'params'),
  validate(meterReportQuerySchema, 'query'),
  meters.report
);

export default router;
