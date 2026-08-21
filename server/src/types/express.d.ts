// Augments Express's Request type so `req.userId` (set by requireAuth,
// see src/middleware/requireAuth.ts) is recognized everywhere without a
// cast. This file exports nothing of its own - the empty `export {}`
// below is what makes TypeScript treat it as a module and apply the
// `declare global` augmentation, instead of a plain ambient script.
export {};

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
