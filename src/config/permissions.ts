export const API_PERMISSIONS = {
  summaryRead: "summary:read",
  contributionsRead: "contributions:read",
  contributionsWrite: "contributions:write",
  contributorsRead: "contributors:read",
  contributorsWrite: "contributors:write",
  settingsRead: "settings:read",
  settingsWrite: "settings:write",
  auth0SyncWrite: "auth0_sync:write"
} as const;

export type ApiPermission = (typeof API_PERMISSIONS)[keyof typeof API_PERMISSIONS];
