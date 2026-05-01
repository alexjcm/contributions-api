import { z } from "zod";

export const SETTINGS_KEYS = ["monthly_amount_cents", "auth0_auto_sync_enabled"] as const;
export type SettingKey = (typeof SETTINGS_KEYS)[number];

const monthlyAmountSettingSchema = z.object({
  key: z.literal("monthly_amount_cents"),
  value: z
    .string()
    .regex(/^\d+$/, "Debe ser texto numérico en centavos")
    .refine((value) => Number(value) >= 1, "Debe ser >= 1")
});

const auth0AutoSyncSettingSchema = z.object({
  key: z.literal("auth0_auto_sync_enabled"),
  value: z.enum(["true", "false"])
});

export const settingsUpdateSchema = z.union([monthlyAmountSettingSchema, auth0AutoSyncSettingSchema]);

export const parseMonthlyAmountCents = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
};

export const parseAuth0AutoSyncEnabled = (value: string | null | undefined): boolean | null => {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
};
