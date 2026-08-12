import { NextFunction, Request, Response } from 'express';
import { AnyZodObject, ZodTypeAny } from 'zod';

type Source = 'body' | 'query' | 'params';

/** Parses and *replaces* the request segment with the Zod-coerced result. */
export function validate(schema: ZodTypeAny | AnyZodObject, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    // req.query is a getter in Express 5; assign defensively.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };
}
