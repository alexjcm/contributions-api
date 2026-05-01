import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { contributors, settings } from "../db/schema";
import {
  Auth0ManagementAPI,
  type Auth0UserRecord
} from "../lib/auth0";
import { nowIso } from "../lib/business-time";
import { withDbReadRetry } from "../lib/db-retry";
import { AppHttpError, isUniqueConstraintError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { success } from "../lib/responses";
import { parseAuth0AutoSyncEnabled } from "../lib/settings";
import { zodValidationHook } from "../lib/validator";
import { requirePermission } from "../middleware/require-permission";
import type { AppBindings } from "../types/app";

const contributorsQuerySchema = z.object({
  status: z.enum(["active", "all"]).optional()
});

const contributorCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().trim().toLowerCase().nullable().optional()
});

const contributorUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().trim().toLowerCase().nullable().optional(),
    status: z.union([z.literal(0), z.literal(1)]).optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, "Debes enviar al menos un campo para actualizar.");

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/)
});

const AUTH0_ERROR_MAX_LENGTH = 400;
const MISSING_COLUMN_HINT = "no such column:";
const AUTH0_STATUS_CHECK_HINT = "check constraint failed: contributors_auth0_sync_status_check";
const AUTH0_STATUS_CHECK_LEGACY_HINT = "check constraint failed: auth0_sync_status in (";

type Auth0ResolvedStatus = "pending_password" | "linked" | "no_access";
type Auth0SyncSkipReason = "auto_sync_disabled" | "no_email";

type Auth0Result =
  | {
      attempted: false;
      reason: Auth0SyncSkipReason;
    }
  | {
      attempted: true;
      status: Auth0ResolvedStatus;
      user_id: string;
      existing?: boolean;
      email_sent?: boolean;
    }
  | {
      attempted: true;
      status: "error";
      detail: string;
      user_id?: string | null;
    };

type ResolvedAuth0User = {
  user: Auth0UserRecord | null;
  source: "id" | "email" | "none";
};

const collectErrorMessages = (error: unknown): string[] => {
  const messages: string[] = [];
  let cursor: unknown = error;
  let guard = 0;

  while (cursor && guard < 4) {
    guard += 1;

    if (cursor instanceof Error) {
      if (cursor.message?.trim()) {
        messages.push(cursor.message.trim());
      }
      cursor = cursor.cause;
      continue;
    }

    if (typeof cursor === "string" && cursor.trim()) {
      messages.push(cursor.trim());
      break;
    }

    break;
  }

  return messages;
};

const summarizeAuth0Error = (error: unknown): string => {
  let detail = "Error desconocido al sincronizar con Auth0.";

  if (error instanceof AppHttpError) {
    detail = `${error.apiError.code}: ${error.apiError.detail}`;
  } else {
    const messages = collectErrorMessages(error);
    if (messages.length > 0) {
      detail = messages.join(" | ");
    }
  }

  return detail.slice(0, AUTH0_ERROR_MAX_LENGTH);
};

const logAuth0SyncIssue = (context: string, data: Record<string, unknown>) => {
  console.error("[Auth0Sync]", context, data);
};

const isSchemaOutdatedError = (error: unknown): boolean => {
  const messages = collectErrorMessages(error).join(" ").toLowerCase();
  return (
    messages.includes(MISSING_COLUMN_HINT) ||
    messages.includes(AUTH0_STATUS_CHECK_HINT) ||
    messages.includes(AUTH0_STATUS_CHECK_LEGACY_HINT)
  );
};

const getContributorById = async (db: ReturnType<typeof createDb>, contributorId: number) => {
  const rows = await db
    .select()
    .from(contributors)
    .where(eq(contributors.id, contributorId));

  return rows[0] ?? null;
};

const readAuth0AutoSyncEnabled = async (db: ReturnType<typeof createDb>): Promise<boolean> => {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "auth0_auto_sync_enabled"));

  return parseAuth0AutoSyncEnabled(rows[0]?.value) ?? false;
};

const markAuth0ErrorState = async (
  db: ReturnType<typeof createDb>,
  contributorId: number,
  updatedBy: string,
  detail: string,
  userId?: string | null
) => {
  await db
    .update(contributors)
    .set({
      auth0SyncStatus: "error",
      auth0LastError: detail,
      auth0LastSyncAt: nowIso(),
      auth0UserId: userId ?? undefined,
      updatedAt: nowIso(),
      updatedBy
    })
    .where(eq(contributors.id, contributorId));
};

const markAuth0LinkedState = async (
  db: ReturnType<typeof createDb>,
  contributorId: number,
  updatedBy: string,
  userId: string,
  status: Auth0ResolvedStatus
) => {
  await db
    .update(contributors)
    .set({
      auth0SyncStatus: status,
      auth0UserId: userId,
      auth0LastSyncAt: nowIso(),
      auth0LastError: null,
      updatedAt: nowIso(),
      updatedBy
    })
    .where(eq(contributors.id, contributorId));
};

const resolveContributorStatus = (user: Auth0UserRecord): Exclude<Auth0ResolvedStatus, "no_access"> => {
  if (!user.isPrimaryDatabase) {
    return "linked";
  }

  return user.lastPasswordReset ? "linked" : "pending_password";
};

const ensureResolvableSocialIdentity = (user: Auth0UserRecord, source: ResolvedAuth0User["source"]) => {
  if (source !== "email") {
    return;
  }

  if (user.isPrimarySocial && !user.emailVerified) {
    throw new AppHttpError(
      409,
      "AUTH0_SOCIAL_EMAIL_NOT_VERIFIED",
      "Existe una cuenta social en Auth0 con ese correo, pero no tiene email verificado. No se adoptará automáticamente."
    );
  }
};

const resolveAuth0UserForContributor = async (params: {
  env: AppBindings;
  email: string | null;
  auth0UserId: string | null;
}): Promise<ResolvedAuth0User> => {
  const { env, email, auth0UserId } = params;

  if (auth0UserId) {
    const userById = await Auth0ManagementAPI.getUserById(auth0UserId, env);
    if (userById) {
      return { user: userById, source: "id" };
    }
  }

  if (!email) {
    return { user: null, source: "none" };
  }

  const usersByEmail = await Auth0ManagementAPI.listUsersByEmail(email, env);

  if (usersByEmail.length === 0) {
    return { user: null, source: "none" };
  }

  if (usersByEmail.length === 1) {
    return { user: usersByEmail[0] ?? null, source: "email" };
  }

  const dcmManagedUsers = usersByEmail.filter((user) => user.isDcmManaged);
  if (dcmManagedUsers.length === 1) {
    return { user: dcmManagedUsers[0] ?? null, source: "email" };
  }

  throw new AppHttpError(
    409,
    "AUTH0_USER_AMBIGUOUS",
    `Se encontraron múltiples cuentas en Auth0 para ${email} y no existe una única cuenta canónica dcm_managed.`
  );
};

const synchronizeExistingAuth0User = async (params: {
  env: AppBindings;
  user: Auth0UserRecord;
  source: ResolvedAuth0User["source"];
  contributorEmail: string | null;
  contributorName: string;
}): Promise<{ status: Exclude<Auth0ResolvedStatus, "no_access">; userId: string }> => {
  const { env, user, source, contributorEmail, contributorName } = params;

  ensureResolvableSocialIdentity(user, source);

  if (user.isPrimaryDatabase) {
    await Auth0ManagementAPI.updateDatabaseUserProfile(
      user.userId,
      {
        name: contributorName,
        ...(contributorEmail && user.email !== contributorEmail ? { email: contributorEmail } : {})
      },
      env
    );
  }

  await Auth0ManagementAPI.markUserAsDcmManaged(user.userId, env);
  await Auth0ManagementAPI.ensureViewerRole(user.userId, env);

  return {
    status: resolveContributorStatus(user),
    userId: user.userId
  };
};

const downgradeContributorAuth0Access = async (params: {
  env: AppBindings;
  email: string | null;
  auth0UserId: string | null;
}): Promise<{ status: Auth0ResolvedStatus; userId: string }> => {
  const resolved = await resolveAuth0UserForContributor({
    env: params.env,
    email: params.email,
    auth0UserId: params.auth0UserId
  });

  if (!resolved.user) {
    throw new AppHttpError(
      409,
      "AUTH0_USER_NOT_FOUND",
      "No se encontró una cuenta de Auth0 para degradar a viewer."
    );
  }

  ensureResolvableSocialIdentity(resolved.user, resolved.source);
  const roles = await Auth0ManagementAPI.getUserRoles(resolved.user.userId, params.env);

  if (roles.length === 0) {
    return {
      status: "no_access",
      userId: resolved.user.userId
    };
  }

  await Auth0ManagementAPI.markUserAsDcmManaged(resolved.user.userId, params.env);
  await Auth0ManagementAPI.ensureViewerOnlyRole(resolved.user.userId, params.env);

  return {
    status: resolveContributorStatus(resolved.user),
    userId: resolved.user.userId
  };
};

const applyAuth0SyncForContributor = async (params: {
  db: ReturnType<typeof createDb>;
  env: AppBindings;
  contributorId: number;
  updatedBy: string;
  name: string;
  email: string | null;
  status: number;
  auth0UserId: string | null;
}): Promise<Auth0Result> => {
  const { db, env, contributorId, updatedBy, name, email, status, auth0UserId } = params;

  if (!email && !auth0UserId) {
    return { attempted: false, reason: "no_email" };
  }

  try {
    if (status === 0) {
      const downgraded = await downgradeContributorAuth0Access({
        env,
        email,
        auth0UserId
      });

      await markAuth0LinkedState(db, contributorId, updatedBy, downgraded.userId, downgraded.status);
      return { attempted: true, status: downgraded.status, user_id: downgraded.userId, existing: true };
    }

    const resolved = await resolveAuth0UserForContributor({ env, email, auth0UserId });

    if (resolved.user) {
      const synchronized = await synchronizeExistingAuth0User({
        env,
        user: resolved.user,
        source: resolved.source,
        contributorEmail: email,
        contributorName: name
      });

      await markAuth0LinkedState(db, contributorId, updatedBy, synchronized.userId, synchronized.status);
      return { attempted: true, status: synchronized.status, user_id: synchronized.userId, existing: true };
    }

    if (!email) {
      return { attempted: false, reason: "no_email" };
    }

    const createdUser = await Auth0ManagementAPI.createDatabaseUser(email, name, env);
    await Auth0ManagementAPI.ensureViewerRole(createdUser.userId, env);
    await Auth0ManagementAPI.sendPasswordResetEmail(email, env);
    await markAuth0LinkedState(db, contributorId, updatedBy, createdUser.userId, "pending_password");

    return {
      attempted: true,
      status: "pending_password",
      user_id: createdUser.userId,
      email_sent: true
    };
  } catch (syncError) {
    const syncDetail = summarizeAuth0Error(syncError);
    logAuth0SyncIssue("sync_failed", {
      contributorId,
      email,
      auth0UserId,
      status,
      detail: syncDetail
    });

    if (isSchemaOutdatedError(syncError)) {
      throw new AppHttpError(
        500,
        "DB_SCHEMA_OUTDATED",
        "No fue posible persistir el estado de sincronización."
      );
    }

    const userId = syncError instanceof AppHttpError && syncError.apiError.code === "AUTH0_USER_NOT_FOUND"
      ? auth0UserId
      : undefined;

    try {
      await markAuth0ErrorState(db, contributorId, updatedBy, syncDetail, userId);
    } catch (persistError) {
      const persistDetail = summarizeAuth0Error(persistError);
      logAuth0SyncIssue("sync_state_persist_failed", {
        contributorId,
        email,
        detail: persistDetail
      });
      throw new AppHttpError(
        500,
        "SYNC_STATE_PERSIST_FAILED",
        `No se pudo persistir el estado de sincronización en D1. Causa: ${persistDetail}`
      );
    }

    return { attempted: true, status: "error", detail: syncDetail, user_id: userId };
  }
};

export const contributorsRoute = createAppRoute();

const listContributorsHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributorsRead),
  zValidator("query", contributorsQuerySchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const query = c.req.valid("query");
    const statusFilter = query.status ?? "active";

    const rows = await withDbReadRetry(
      async () =>
        db
          .select({
            id: contributors.id,
            name: contributors.name,
            email: contributors.email,
            status: contributors.status,
            auth0SyncStatus: contributors.auth0SyncStatus,
            auth0UserId: contributors.auth0UserId,
            auth0LastSyncAt: contributors.auth0LastSyncAt,
            auth0LastError: contributors.auth0LastError,
            createdAt: contributors.createdAt,
            createdBy: contributors.createdBy,
            updatedAt: contributors.updatedAt,
            updatedBy: contributors.updatedBy
          })
          .from(contributors)
          .where(statusFilter === "all" ? undefined : eq(contributors.status, 1))
          .orderBy(desc(contributors.createdAt), desc(contributors.id)),
      { label: "contributors.list" }
    );

    return success(c, 200, { items: rows });
  }
);

const createContributorHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributorsWrite),
  zValidator("json", contributorCreateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const auth = c.get("auth");
    const payload = c.req.valid("json");
    const now = nowIso();

    try {
      const inserted = await db
        .insert(contributors)
        .values({
          name: payload.name,
          email: payload.email ?? null,
          status: 1,
          auth0SyncStatus: "not_linked",
          auth0UserId: null,
          auth0LastSyncAt: null,
          auth0LastError: null,
          createdAt: now,
          createdBy: auth.userId,
          updatedAt: now,
          updatedBy: auth.userId
        })
        .returning();

      const newContributor = inserted[0];
      if (!newContributor) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuyente creado.");
      }

      let auth0: Auth0Result | undefined;

      if (!payload.email) {
        auth0 = { attempted: false, reason: "no_email" };
      } else {
        const autoSyncEnabled = await readAuth0AutoSyncEnabled(db);
        auth0 = autoSyncEnabled
          ? await applyAuth0SyncForContributor({
              db,
              env: c.env,
              contributorId: newContributor.id,
              updatedBy: auth.userId,
              name: payload.name,
              email: payload.email,
              status: 1,
              auth0UserId: null
            })
          : { attempted: false, reason: "auto_sync_disabled" };
      }

      const finalContributor = await getContributorById(db, newContributor.id);
      if (!finalContributor) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuyente creado.");
      }

      return success(c, 201, auth0 ? { contribuyente: finalContributor, auth0 } : { contribuyente: finalContributor });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppHttpError(409, "EMAIL_CONFLICT", "El email ya está en uso por otro contribuyente.");
      }

      throw error;
    }
  }
);

const updateContributorHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributorsWrite),
  zValidator("param", idParamSchema, zodValidationHook),
  zValidator("json", contributorUpdateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");
    const contributorId = Number(id);

    const existing = await getContributorById(db, contributorId);
    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuyente no existe.");
    }

    const nextEmail = Object.hasOwn(payload, "email") ? (payload.email ?? null) : existing.email;
    const nextName = payload.name ?? existing.name;
    const nextStatus = payload.status ?? existing.status;

    try {
      await db
        .update(contributors)
        .set({
          name: nextName,
          email: nextEmail,
          status: nextStatus,
          updatedAt: nowIso(),
          updatedBy: auth.userId
        })
        .where(eq(contributors.id, contributorId));

      const autoSyncEnabled = await readAuth0AutoSyncEnabled(db);
      const auth0 = autoSyncEnabled
        ? await applyAuth0SyncForContributor({
            db,
            env: c.env,
            contributorId,
            updatedBy: auth.userId,
            name: nextName,
            email: nextEmail,
            status: nextStatus,
            auth0UserId: existing.auth0UserId
          })
        : nextEmail || existing.auth0UserId
          ? { attempted: false, reason: "auto_sync_disabled" as const }
          : { attempted: false, reason: "no_email" as const };

      const finalContributor = await getContributorById(db, contributorId);
      if (!finalContributor) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuyente actualizado.");
      }

      return success(c, 200, { contribuyente: finalContributor, auth0 });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppHttpError(409, "EMAIL_CONFLICT", "El email ya está en uso por otro contribuyente.");
      }

      throw error;
    }
  }
);

contributorsRoute.get("/", ...listContributorsHandlers);
contributorsRoute.post("/", ...createContributorHandlers);
contributorsRoute.put("/:id", ...updateContributorHandlers);
