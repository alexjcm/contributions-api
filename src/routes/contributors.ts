import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { contributors } from "../db/schema";
import { withDbReadRetry } from "../lib/db-retry";
import { AppHttpError, isUniqueConstraintError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { nowIso } from "../lib/business-time";
import { success } from "../lib/responses";
import { zodValidationHook } from "../lib/validator";
import { Auth0ManagementAPI } from "../lib/auth0";
import { requirePermission } from "../middleware/require-permission";

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
            createdAt: contributors.createdAt,
            createdBy: contributors.createdBy,
            updatedAt: contributors.updatedAt,
            updatedBy: contributors.updatedBy
          })
          .from(contributors)
          .where(statusFilter === "all" ? undefined : eq(contributors.status, 1))
          .orderBy(asc(contributors.name)),
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
          createdAt: now,
          createdBy: auth.userId,
          updatedAt: now,
          updatedBy: auth.userId
        })
        .returning();

      const newContributor = inserted[0];

      if (payload.email) {
        try {
          const existingUserId = await Auth0ManagementAPI.getUserByEmail(payload.email, c.env);
          if (existingUserId) {
            return success(c, 201, { contribuyente: newContributor, auth0: { user_id: existingUserId, existing: true } });
          }

          const newUserId = await Auth0ManagementAPI.createUser(payload.email, payload.name, c.env);
          await Auth0ManagementAPI.sendPasswordResetEmail(payload.email, c.env);

          return success(c, 201, { contribuyente: newContributor, auth0: { user_id: newUserId, email_sent: true } });
        } catch (auth0Error) {
          await db.delete(contributors).where(eq(contributors.id, newContributor.id));
          throw auth0Error;
        }
      }

      return success(c, 201, { contribuyente: newContributor });
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

    const existingRows = await db
      .select()
      .from(contributors)
      .where(eq(contributors.id, contributorId));

    const existing = existingRows[0];

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuyente no existe.");
    }

    try {
      await db
        .update(contributors)
        .set({
          name: payload.name ?? existing.name,
          email: Object.hasOwn(payload, "email") ? (payload.email ?? null) : existing.email,
          status: payload.status ?? existing.status,
          updatedAt: nowIso(),
          updatedBy: auth.userId
        })
        .where(eq(contributors.id, contributorId));

      const updatedRows = await db
        .select()
        .from(contributors)
        .where(eq(contributors.id, contributorId));

      const updated = updatedRows[0];

      if (!updated) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuyente actualizado.");
      }

      let auth0ResponseData: Record<string, any> | undefined = undefined;

      try {
        if (updated.email) {
          const existingUserId = await Auth0ManagementAPI.getUserByEmail(updated.email, c.env);
          
          if (existingUserId) {
            if (existing.name !== updated.name) {
              await Auth0ManagementAPI.updateUser(existingUserId, { name: updated.name }, c.env);
            }
            auth0ResponseData = { user_id: existingUserId, existing: true };
          } else {
            const newUserId = await Auth0ManagementAPI.createUser(updated.email, updated.name, c.env);
            await Auth0ManagementAPI.sendPasswordResetEmail(updated.email, c.env);
            auth0ResponseData = { user_id: newUserId, email_sent: true };
          }
        }

        if (existing.email && existing.email !== updated.email) {
          try {
            const oldUserId = await Auth0ManagementAPI.getUserByEmail(existing.email, c.env);
            if (oldUserId) {
              await Auth0ManagementAPI.deleteUser(oldUserId, c.env);
            }
          } catch (cleanupError) {
            console.error(`[Auth0] Orphan cleanup failed for ${existing.email}:`, cleanupError);
          }
        }
      } catch (auth0Error) {
        // Compensación (Rollback) local
        await db
          .update(contributors)
          .set({
            name: existing.name,
            email: existing.email,
            status: existing.status,
            updatedAt: existing.updatedAt,
            updatedBy: existing.updatedBy
          })
          .where(eq(contributors.id, contributorId));
        throw auth0Error;
      }

      if (auth0ResponseData) {
        return success(c, 200, { contribuyente: updated, auth0: auth0ResponseData });
      }
      return success(c, 200, { contribuyente: updated });
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
