import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { env } from './config/env';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { generalLimiter } from './middlewares/rateLimiter';
import { auditRequests } from './middlewares/audit';
import { ApiError } from './utils/ApiError';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Assets are served to a separate SPA origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin/simple requests and tools send no Origin header.
        if (!origin || env.cors.origins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not permitted by CORS`));
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  app.use(generalLimiter);

  // Maintenance-ticket photos.
  app.use(
    env.uploads.publicBaseUrl,
    express.static(env.uploads.dir, { maxAge: '7d', fallthrough: true })
  );

  // Mounted ahead of the routes so every mutation is swept into the activity
  // log; it only writes once the response has finished, and only on success.
  app.use('/api/v1', auditRequests, routes);

  // Translate Multer's own errors into the standard envelope.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) => {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `Image exceeds the ${Math.round(env.uploads.maxBytes / 1024 / 1024)}MB limit`
            : err.message;
        return next(ApiError.badRequest(message));
      }
      next(err);
    }
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
