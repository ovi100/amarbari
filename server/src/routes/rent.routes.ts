import { Router } from 'express';
import * as rent from '../controllers/rent.controller';
import { requireApprovedTenant, requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { requestDueSchema } from '../utils/validators';

const router = Router();

router.use(requireAuth, requireApprovedTenant);

router.get('/my-summary', rent.mySummary);
router.post('/request-due', validate(requestDueSchema), rent.requestDueHandler);

export default router;
