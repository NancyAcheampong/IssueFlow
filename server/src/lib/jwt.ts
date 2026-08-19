import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// D-02: access token only for now (JWT_EXPIRES_IN defaults to 1d in
// .env.example); refresh tokens are an explicitly optional future
// extension per the spec, not something Phase 1 needs.
//
// Payload is deliberately minimal - just the user id (`sub`, the
// standard JWT claim name for "subject"). Nothing else goes in here on
// purpose: a name or email embedded in the token would go stale the
// moment a user edits their profile, since the token itself can't be
// updated after issuing. Anything route handlers need beyond the id,
// they look up fresh from the database.
export interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    // JWT_EXPIRES_IN is developer-controlled config (from .env), not
    // user input - the cast is safe here even though @types/jsonwebtoken
    // wants a narrower literal type than plain `string`.
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
}
