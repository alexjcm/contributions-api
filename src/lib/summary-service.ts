import { and, asc, eq } from "drizzle-orm";

import { createDb } from "../db/client";
import { contributors, contributions, settings } from "../db/schema";
import { withDbReadRetry } from "./db-retry";
import { parseMonthlyAmountCents } from "./settings";

type DbClient = ReturnType<typeof createDb>;

type MonthlyStats = {
  totalPaidCents: number;
  monthTotals: Map<number, number>;
};

const DEFAULT_MONTHLY_AMOUNT_CENTS = 3200;

export const readSummarySourceData = async (db: DbClient, year: number) => {
  const [monthlyRows, contributorRows, contributionRows] = await withDbReadRetry(
    async () =>
      Promise.all([
        db
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, "monthly_amount_cents")),
        db
          .select({
            id: contributors.id,
            name: contributors.name,
            email: contributors.email,
            status: contributors.status
          })
          .from(contributors)
          .orderBy(asc(contributors.name)),
        db
          .select({
            contributorId: contributions.contributorId,
            month: contributions.month,
            amountCents: contributions.amountCents
          })
          .from(contributions)
          .where(and(eq(contributions.status, 1), eq(contributions.year, year)))
      ]),
    { label: "summary.reads" }
  );

  return {
    monthlyRows,
    contributorRows,
    contributionRows
  };
};

const buildStatsByContributor = (
  contributionRows: Array<{ contributorId: number; month: number; amountCents: number }>
) => {
  const statsByContributor = new Map<number, MonthlyStats>();

  for (const row of contributionRows) {
    const stats = statsByContributor.get(row.contributorId) ?? {
      totalPaidCents: 0,
      monthTotals: new Map<number, number>()
    };

    stats.totalPaidCents += row.amountCents;

    const currentMonthAmount = stats.monthTotals.get(row.month) ?? 0;
    stats.monthTotals.set(row.month, currentMonthAmount + row.amountCents);

    statsByContributor.set(row.contributorId, stats);
  }

  return statsByContributor;
};

const getContributorState = (
  totalPaidCents: number,
  expectedPerContributorCents: number
): "pending" | "incomplete" | "complete" | "overpaid" => {
  if (totalPaidCents === 0) {
    return "pending";
  }

  if (totalPaidCents < expectedPerContributorCents) {
    return "incomplete";
  }

  if (totalPaidCents === expectedPerContributorCents) {
    return "complete";
  }

  return "overpaid";
};

export const buildAnnualSummary = (
  year: number,
  sourceData: Awaited<ReturnType<typeof readSummarySourceData>>
) => {
  const monthlyAmountCents = parseMonthlyAmountCents(sourceData.monthlyRows[0]?.value) ?? DEFAULT_MONTHLY_AMOUNT_CENTS;
  const expectedPerContributorCents = monthlyAmountCents * 12;
  const statsByContributor = buildStatsByContributor(sourceData.contributionRows);

  const contributorSummary = sourceData.contributorRows
    .map((contributor) => {
      const stats = statsByContributor.get(contributor.id) ?? {
        totalPaidCents: 0,
        monthTotals: new Map<number, number>()
      };

      if (contributor.status === 0 && stats.totalPaidCents === 0) {
        return null;
      }

      let monthsByPresence = 0;
      for (let month = 1; month <= 12; month += 1) {
        if ((stats.monthTotals.get(month) ?? 0) > 0) {
          monthsByPresence += 1;
        }
      }

      const monthsByVolume = stats.totalPaidCents / monthlyAmountCents;
      const monthsComplete = Math.min(12, Math.max(monthsByPresence, monthsByVolume));

      return {
        contributorId: contributor.id,
        name: contributor.name,
        email: contributor.email,
        status: contributor.status as 0 | 1,
        totalPaidCents: stats.totalPaidCents,
        expectedCents: expectedPerContributorCents,
        monthsComplete,
        monthsPendingOrIncomplete: 12 - monthsComplete,
        state: getContributorState(stats.totalPaidCents, expectedPerContributorCents)
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const collectedCents = contributorSummary.reduce((acc, item) => acc + item.totalPaidCents, 0);
  const expectedCents = contributorSummary.length * expectedPerContributorCents;
  const activeContributorsCount = contributorSummary.filter((item) => item.status === 1).length;
  const inactiveContributorsCount = contributorSummary.filter((item) => item.status === 0).length;

  return {
    year,
    monthlyAmountCents,
    totals: {
      collectedCents,
      expectedCents,
      contributorsCount: contributorSummary.length,
      activeContributorsCount,
      inactiveContributorsCount
    },
    contributors: contributorSummary
  };
};
