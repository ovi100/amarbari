import { NextFunction, Request, RequestHandler, Response } from 'express';

/** Forwards rejected promises from async route handlers into Express error middleware. */
export const asyncHandler =
  <T extends Request = Request>(
    fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
