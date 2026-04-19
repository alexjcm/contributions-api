import { and, asc, desc, eq, sql } from "drizzle-orm";

import { createDb } from "../db/client";
import { contributors, contributions } from "../db/schema";
import { nowIso } from "./business-time";
import { withDbReadRetry } from "./db-retry";
import { AppHttpError, isUniqueConstraintError } from "./errors";
import type { AuthContext } from "../types/app";

type DbClient = ReturnType<typeof createDb>;

type ContributionMutationPayload = {
  contributorId: number;
  year: number;
  month: number;
  amountCents: number;
};

type ContributionUpdatePayload = Partial<ContributionMutationPayload>;

type ListContributionsParams = {
  year: number;
};

export const getContributionResponseById = async (db: DbClient, id: number) => {
  const rows = await db
    .select({
      id: contributions.id,
      contributorId: contributions.contributorId,
      contributorName: contributors.name,
      contributorStatus: contributors.status,
      year: contributions.year,
      month: contributions.month,
      amountCents: contributions.amountCents,
      status: contributions.status,
      createdAt: contributions.createdAt,
      createdBy: contributions.createdBy,
      updatedAt: contributions.updatedAt,
      updatedBy: contributions.updatedBy
    })
    .from(contributions)
    .innerJoin(contributors, eq(contributors.id, contributions.contributorId))
    .where(eq(contributions.id, id));

  return rows[0] ?? null;
};

export const getContributionRecordById = async (db: DbClient, id: number) => {
  const rows = await db.select().from(contributions).where(eq(contributions.id, id));
  return rows[0] ?? null;
};

export const ensureActiveContributor = async (db: DbClient, contributorId: number) => {
  const rows = await db
    .select({ id: contributors.id, status: contributors.status })
    .from(contributors)
    .where(eq(contributors.id, contributorId));

  const contributor = rows[0];

  if (!contributor) {
    throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuyente no existe.");
  }

  if (contributor.status !== 1) {
    throw new AppHttpError(422, "CONTRIBUTOR_INACTIVE", "No se pueden registrar aportes para contribuyentes inactivos.");
  }
};

export const listContributions = async (db: DbClient, params: ListContributionsParams) => {
  const { year } = params;
  const whereClause = and(eq(contributions.status, 1), eq(contributions.year, year));

  const items = await db
    .select({
      id: contributions.id,
      contributorId: contributions.contributorId,
      contributorName: contributors.name,
      year: contributions.year,
      month: contributions.month,
      amountCents: contributions.amountCents,
      status: contributions.status,
      createdAt: contributions.createdAt,
      createdBy: contributions.createdBy,
      updatedAt: contributions.updatedAt,
      updatedBy: contributions.updatedBy
    })
    .from(contributions)
    .innerJoin(contributors, eq(contributors.id, contributions.contributorId))
    .where(whereClause)
    .orderBy(desc(contributions.month), asc(contributors.name));

  return {
    items
  };
};

export const createContribution = async (
  db: DbClient,
  auth: AuthContext,
  payload: ContributionMutationPayload
) => {
  const now = nowIso();

  try {
    const inserted = await db
      .insert(contributions)
      .values({
        contributorId: payload.contributorId,
        year: payload.year,
        month: payload.month,
        amountCents: payload.amountCents,
        status: 1,
        createdAt: now,
        createdBy: auth.userId,
        updatedAt: now,
        updatedBy: auth.userId
      })
      .returning({ id: contributions.id });

    const createdId = inserted[0]?.id;

    if (!createdId) {
      throw new AppHttpError(500, "CREATE_FAILED", "No se pudo crear el aporte.");
    }

    const created = await getContributionResponseById(db, createdId);

    if (!created) {
      throw new AppHttpError(500, "CREATE_FAILED", "No se pudo recuperar el aporte creado.");
    }

    return created;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppHttpError(
        409,
        "ACTIVE_CONTRIBUTION_CONFLICT",
        "Ya existe un aporte activo para ese contribuyente en el mismo año y mes."
      );
    }

    throw error;
  }
};

export const updateContribution = async (
  db: DbClient,
  auth: AuthContext,
  contributionId: number,
  existing: Awaited<ReturnType<typeof getContributionRecordById>>,
  payload: ContributionUpdatePayload
) => {
  if (!existing) {
    throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
  }

  if (existing.status === 0) {
    throw new AppHttpError(409, "INACTIVE_RECORD", "No se puede editar un aporte inactivo.");
  }

  const targetContributorId = payload.contributorId ?? existing.contributorId;
  const targetYear = payload.year ?? existing.year;
  const targetMonth = payload.month ?? existing.month;
  const targetAmountCents = payload.amountCents ?? existing.amountCents;

  const hasChanges =
    targetContributorId !== existing.contributorId ||
    targetYear !== existing.year ||
    targetMonth !== existing.month ||
    targetAmountCents !== existing.amountCents;

  if (!hasChanges) {
    const current = await getContributionResponseById(db, contributionId);

    if (!current) {
      throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el aporte.");
    }

    return current;
  }

  try {
    await db
      .update(contributions)
      .set({
        contributorId: targetContributorId,
        year: targetYear,
        month: targetMonth,
        amountCents: targetAmountCents,
        updatedAt: nowIso(),
        updatedBy: auth.userId
      })
      .where(eq(contributions.id, contributionId));

    const updated = await getContributionResponseById(db, contributionId);

    if (!updated) {
      throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el aporte actualizado.");
    }

    return updated;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppHttpError(
        409,
        "ACTIVE_CONTRIBUTION_CONFLICT",
        "Ya existe un aporte activo para ese contribuyente en el mismo año y mes."
      );
    }

    throw error;
  }
};

export const deactivateContribution = async (
  db: DbClient,
  auth: AuthContext,
  contributionId: number,
  existing: Awaited<ReturnType<typeof getContributionRecordById>>
) => {
  if (!existing) {
    throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
  }

  if (existing.status === 0) {
    const current = await getContributionResponseById(db, contributionId);

    if (!current) {
      throw new AppHttpError(500, "READ_FAILED", "No se pudo recuperar el aporte inactivo.");
    }

    return current;
  }

  await db
    .update(contributions)
    .set({
      status: 0,
      updatedAt: nowIso(),
      updatedBy: auth.userId
    })
    .where(eq(contributions.id, contributionId));

  const updated = await getContributionResponseById(db, contributionId);

  if (!updated) {
    throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el aporte desactivado.");
  }

  return updated;
};
