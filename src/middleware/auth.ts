import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import type { MiddlewareHandler } from "hono";

import { getRoleFromClaims } from "../auth/role-claims";
import { getClerkAuthorizedParties } from "../lib/cors";
import { AppHttpError } from "../lib/errors";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

const readClaims = (auth: ReturnType<typeof getAuth>): Record<string, unknown> => {
  if (auth.sessionClaims && typeof auth.sessionClaims === "object") {
    return auth.sessionClaims as Record<string, unknown>;
  }

  return {};
};

const hasAuthHint = (c: Parameters<AppMiddleware>[0]): boolean => {
  const authorization = c.req.header("authorization");
  if (authorization && authorization.trim().length > 0) {
    return true;
  }

  const cookie = c.req.header("cookie");
  return Boolean(cookie && cookie.includes("__session="));
};

export const applyClerkMiddleware: AppMiddleware = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  // Skip Clerk handshake/auth processing when request has no auth hints.
  // This avoids internal handshake errors on anonymous API calls and lets requireAuth return 401.
  if (!hasAuthHint(c)) {
    await next();
    return;
  }

  const middlewareOptions = {
    secretKey: c.env.CLERK_SECRET_KEY,
    publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
    authorizedParties: getClerkAuthorizedParties(c.env),
    ...(c.env.CLERK_JWT_KEY ? { jwtKey: c.env.CLERK_JWT_KEY } : {})
  };

  const middleware = clerkMiddleware(middlewareOptions);

  await middleware(c, next);
};

export const requireAuth: AppMiddleware = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  if (!hasAuthHint(c)) {
    throw new AppHttpError(401, "UNAUTHENTICATED", "Se requiere sesión autenticada.");
  }

  const auth = getAuth(c, { acceptsToken: "session_token" });

  if (!auth.isAuthenticated || !auth.userId) {
    throw new AppHttpError(401, "UNAUTHENTICATED", "Se requiere sesión autenticada.");
  }

  const role = getRoleFromClaims(readClaims(auth));

  if (!role) {
    throw new AppHttpError(403, "FORBIDDEN_ROLE", "El claim de rol es inválido o no existe.");
  }

  c.set("auth", {
    userId: auth.userId,
    role
  });

  await next();
};
