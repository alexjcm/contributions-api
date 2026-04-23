import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { getCurrentBusinessYear } from "../lib/business-time";
import { buildAnnualSummary, readSummarySourceData } from "../lib/summary-service";
import { success } from "../lib/responses";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { requirePermission } from "../middleware/require-permission";
import { zodValidationHook } from "../lib/validator";

const summaryQuerySchema = z.object({
  year: z.string().regex(/^\d+$/).optional()
});

export const summaryRoute = createAppRoute();

const getSummaryHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.summaryRead),
  zValidator("query", summaryQuerySchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.DCM_DB_BINDING);
    const query = c.req.valid("query");

    const year = query.year ? Number(query.year) : getCurrentBusinessYear();
    const sourceData = await readSummarySourceData(db, year);
    const summary = buildAnnualSummary(year, sourceData);

    return success(c, 200, summary);
  }
);

summaryRoute.get("/", ...getSummaryHandlers);
