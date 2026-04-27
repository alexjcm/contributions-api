import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { getCurrentBusinessYear } from "../lib/business-time";
import {
  createContribution,
  deactivateContribution,
  ensureActiveContributor,
  getContributionRecordById,
  listContributions,
  updateContribution
} from "../lib/contributions-service";
import { parseMonthlyAmountCents } from "../lib/settings";
import { getMinContributionYear, readSummarySourceData } from "../lib/summary-service";
import { AppHttpError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { assertCanMutateContributionYear } from "../lib/period";
import { success } from "../lib/responses";
import { zodValidationHook } from "../lib/validator";
import { requirePermission } from "../middleware/require-permission";

const contributionsQuerySchema = z.object({
  year: z.string().regex(/^\d+$/).optional()
});

const contributionCreateSchema = z.object({
  contributorId: z.number().int().positive(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  amountCents: z.number().int().min(1)
});

const contributionUpdateSchema = contributionCreateSchema
  .partial()
  .refine((payload) => Object.keys(payload).length > 0, "Debes enviar al menos un campo para actualizar.");

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/)
});

export const contributionsRoute = createAppRoute();

const listContributionsHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsRead),
  zValidator("query", contributionsQuerySchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const query = c.req.valid("query");

    const year = query.year ? Number(query.year) : getCurrentBusinessYear();
    const result = await listContributions(db, {
      year
    });

    return success(c, 200, {
      items: result.items
    });
  }
);

const getContributionsMetaHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsRead),
  zValidator("query", contributionsQuerySchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const query = c.req.valid("query");
    const year = query.year ? Number(query.year) : getCurrentBusinessYear();
 
    const sourceData = await readSummarySourceData(db, year);
    const minYear = await getMinContributionYear(db);
    const monthlyAmountCents = parseMonthlyAmountCents(sourceData.monthlyRows[0]?.value) ?? 3200;
 
    // Aggregate totalPaidCents per contributor for the year
    const statsByContributor = new Map<number, number>();
    for (const row of sourceData.contributionRows) {
      const current = statsByContributor.get(row.contributorId) ?? 0;
      statsByContributor.set(row.contributorId, current + row.amountCents);
    }
 
    const contributorMeta = sourceData.contributorRows.map((contributor) => ({
      contributorId: contributor.id,
      name: contributor.name,
      email: contributor.email,
      status: contributor.status as 0 | 1,
      totalPaidCents: statsByContributor.get(contributor.id) ?? 0
    }));
 
    return success(c, 200, {
      year,
      minYear,
      monthlyAmountCents,
      contributors: contributorMeta
    });
  }
);

const createContributionHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsWrite),
  zValidator("json", contributionCreateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const auth = c.get("auth");
    const payload = c.req.valid("json");

    assertCanMutateContributionYear(auth.permissions, payload.year);
    await ensureActiveContributor(db, payload.contributorId);
    const created = await createContribution(db, auth, payload);
    return success(c, 201, created);
  }
);

const updateContributionHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsWrite),
  zValidator("param", idParamSchema, zodValidationHook),
  zValidator("json", contributionUpdateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");
    const contributionId = Number(id);
    const existing = await getContributionRecordById(db, contributionId);

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
    }

    const targetYear = payload.year ?? existing.year;
    assertCanMutateContributionYear(auth.permissions, targetYear);

    const targetContributorId = payload.contributorId ?? existing.contributorId;
    await ensureActiveContributor(db, targetContributorId);
    const updated = await updateContribution(db, auth, contributionId, existing, payload);
    return success(c, 200, updated);
  }
);

const deleteContributionHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsWrite),
  zValidator("param", idParamSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const contributionId = Number(id);
    const existing = await getContributionRecordById(db, contributionId);

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
    }

    assertCanMutateContributionYear(auth.permissions, existing.year);
    const updated = await deactivateContribution(db, auth, contributionId, existing);
    return success(c, 200, updated);
  }
);

contributionsRoute.get("/", ...listContributionsHandlers);
contributionsRoute.get("/meta", ...getContributionsMetaHandlers);
contributionsRoute.post("/", ...createContributionHandlers);
contributionsRoute.put("/:id", ...updateContributionHandlers);
contributionsRoute.delete("/:id", ...deleteContributionHandlers);
