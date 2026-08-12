import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { validate } from '../middlewares/validate';
import { requireAuth } from '../middlewares/auth';
import { authLimiter, otpLimiter } from '../middlewares/rateLimiter';
import {
  loginSchema,
  registerSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from '../utils/validators';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), auth.register);
router.post('/send-otp', otpLimiter, validate(sendOtpSchema), auth.sendOtp);
router.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), auth.verifyOtpHandler);
router.post('/login', authLimiter, validate(loginSchema), auth.login);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);
router.get('/me', requireAuth, auth.me);

export default router;
