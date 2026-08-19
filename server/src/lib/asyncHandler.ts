import type { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Express 4 does not catch rejected promises from an async route handler -
// if one throws (or an awaited call rejects), the request just hangs
// forever instead of reaching errorHandler. Wrapping every async handler
// in this forwards any rejection to next(err), which is what actually
// gets it into our error-handling middleware.
export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
