import { AppHttpError } from "./errors";
import type { AppBindings } from "../types/app";

export const DCM_MANAGED_APP_METADATA_KEY = "dcm_managed";
export const DCM_PASSWORD_SETUP_PENDING_APP_METADATA_KEY = "dcm_password_setup_pending";

type Auth0TokenResponse = {
  access_token?: string;
};

type Auth0IdentityResponse = {
  provider?: string;
  connection?: string;
  user_id?: string;
};

type Auth0UserResponse = {
  user_id?: string;
  email?: string | null;
  email_verified?: boolean;
  name?: string | null;
  last_password_reset?: string | null;
  identities?: Auth0IdentityResponse[];
  app_metadata?: Record<string, unknown> | null;
};

export type Auth0Role = {
  id: string;
  name: string;
};

export type Auth0UserRecord = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  lastPasswordReset: string | null;
  appMetadata: Record<string, unknown>;
  isDcmManaged: boolean;
  isPrimaryDatabase: boolean;
  isPrimarySocial: boolean;
};

type UpdateDatabaseUserProfileInput = {
  name?: string;
  email?: string;
};

const toAuth0UserRecord = (user: Auth0UserResponse): Auth0UserRecord => {
  const identities = Array.isArray(user.identities)
    ? user.identities
        .filter((identity): identity is Required<Pick<Auth0IdentityResponse, "provider" | "user_id">> & Auth0IdentityResponse =>
          Boolean(identity?.provider && identity.user_id)
        )
    : [];

  const primaryIdentity = identities[0] ?? null;
  const appMetadata =
    user.app_metadata && typeof user.app_metadata === "object" && !Array.isArray(user.app_metadata)
      ? { ...user.app_metadata }
      : {};

  return {
    userId: user.user_id ?? "",
    email: user.email ?? null,
    emailVerified: user.email_verified === true,
    name: user.name ?? null,
    lastPasswordReset: user.last_password_reset ?? null,
    appMetadata,
    isDcmManaged: appMetadata[DCM_MANAGED_APP_METADATA_KEY] === true,
    isPrimaryDatabase: primaryIdentity?.provider === "auth0",
    isPrimarySocial: primaryIdentity !== null && primaryIdentity.provider !== "auth0"
  };
};

const readErrorText = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string; error?: string; error_description?: string };
    return data.message ?? data.error_description ?? data.error ?? response.statusText;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
};

const buildManagementUrl = (env: AppBindings, path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${env.AUTH0_DOMAIN}/api/v2${normalizedPath}`;
};

const generateSecureTempPassword = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const base = btoa(String.fromCharCode(...bytes)).replace(/[/+=]/g, "");
  return `${base}A1!a`;
};

export class Auth0ManagementAPI {
  private static async getAccessToken(env: AppBindings): Promise<string> {
    const response = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: env.AUTH0_M2M_CLIENT_ID,
        client_secret: env.AUTH0_M2M_CLIENT_SECRET,
        audience: env.AUTH0_M2M_AUDIENCE
      })
    });

    if (!response.ok) {
      const detail = await readErrorText(response);
      throw new AppHttpError(500, "AUTH0_TOKEN_REQUEST_FAILED", `No se pudo obtener token de Auth0: ${detail}`);
    }

    const data = (await response.json()) as Auth0TokenResponse;
    if (!data.access_token) {
      throw new AppHttpError(500, "AUTH0_TOKEN_RESPONSE_INVALID", "Auth0 no devolvió access_token.");
    }

    return data.access_token;
  }

  private static async managementRequest<T>(
    env: AppBindings,
    path: string,
    init?: RequestInit & { allowNotFound?: boolean }
  ): Promise<T | null> {
    const token = await this.getAccessToken(env);
    const { allowNotFound = false, headers, ...requestInit } = init ?? {};
    const response = await fetch(buildManagementUrl(env, path), {
      ...requestInit,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers
      }
    });

    if (allowNotFound && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const detail = await readErrorText(response);
      throw new AppHttpError(500, "AUTH0_MANAGEMENT_REQUEST_FAILED", `Auth0 respondió ${response.status}: ${detail}`);
    }

    if (response.status === 204) {
      return null;
    }

    return (await response.json()) as T;
  }

  public static async listUsersByEmail(email: string, env: AppBindings): Promise<Auth0UserRecord[]> {
    const users = await this.managementRequest<Auth0UserResponse[]>(
      env,
      `/users-by-email?email=${encodeURIComponent(email)}`
    );

    return (users ?? [])
      .map(toAuth0UserRecord)
      .filter((user) => user.userId.length > 0);
  }

  public static async getUserById(userId: string, env: AppBindings): Promise<Auth0UserRecord | null> {
    const user = await this.managementRequest<Auth0UserResponse>(
      env,
      `/users/${encodeURIComponent(userId)}`,
      { allowNotFound: true }
    );

    if (!user?.user_id) {
      return null;
    }

    return toAuth0UserRecord(user);
  }

  public static async getUserRoles(userId: string, env: AppBindings): Promise<Auth0Role[]> {
    const roles = await this.managementRequest<Array<{ id?: string; name?: string }>>(
      env,
      `/users/${encodeURIComponent(userId)}/roles`
    );

    return (roles ?? [])
      .filter((role): role is { id: string; name: string } => Boolean(role?.id && role?.name))
      .map((role) => ({ id: role.id, name: role.name }));
  }

  public static async ensureViewerRole(userId: string, env: AppBindings): Promise<void> {
    const roles = await this.getUserRoles(userId, env);
    if (roles.some((role) => role.id === env.AUTH0_VIEWER_ROLE_ID)) {
      return;
    }

    await this.managementRequest(
      env,
      `/users/${encodeURIComponent(userId)}/roles`,
      {
        method: "POST",
        body: JSON.stringify({ roles: [env.AUTH0_VIEWER_ROLE_ID] })
      }
    );
  }

  public static async ensureViewerOnlyRole(userId: string, env: AppBindings): Promise<void> {
    const roles = await this.getUserRoles(userId, env);
    const hasViewerRole = roles.some((role) => role.id === env.AUTH0_VIEWER_ROLE_ID);

    if (!hasViewerRole) {
      await this.managementRequest(
        env,
        `/users/${encodeURIComponent(userId)}/roles`,
        {
          method: "POST",
          body: JSON.stringify({ roles: [env.AUTH0_VIEWER_ROLE_ID] })
        }
      );
    }

    const rolesToRemove = roles
      .filter((role) => role.id !== env.AUTH0_VIEWER_ROLE_ID)
      .map((role) => role.id);

    if (rolesToRemove.length === 0) {
      return;
    }

    await this.managementRequest(
      env,
      `/users/${encodeURIComponent(userId)}/roles`,
      {
        method: "DELETE",
        body: JSON.stringify({ roles: rolesToRemove })
      }
    );
  }

  public static async markUserAsDcmManaged(userId: string, env: AppBindings): Promise<void> {
    const user = await this.getUserById(userId, env);
    if (!user) {
      throw new AppHttpError(404, "AUTH0_USER_NOT_FOUND", "No se encontró el usuario en Auth0.");
    }

    if (user.isDcmManaged) {
      return;
    }

    await this.managementRequest(
      env,
      `/users/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          app_metadata: {
            ...user.appMetadata,
            [DCM_MANAGED_APP_METADATA_KEY]: true
          }
        })
      }
    );
  }

  public static async createDatabaseUser(email: string, name: string, env: AppBindings): Promise<Auth0UserRecord> {
    const createdUser = await this.managementRequest<Auth0UserResponse>(
      env,
      "/users",
      {
        method: "POST",
        body: JSON.stringify({
          connection: env.AUTH0_CONNECTION,
          email,
          name,
          password: generateSecureTempPassword(),
          verify_email: false,
          app_metadata: {
            [DCM_MANAGED_APP_METADATA_KEY]: true,
            [DCM_PASSWORD_SETUP_PENDING_APP_METADATA_KEY]: true
          }
        })
      }
    );

    if (!createdUser?.user_id) {
      throw new AppHttpError(500, "AUTH0_USER_CREATE_FAILED", "Auth0 no devolvió el usuario creado.");
    }

    return toAuth0UserRecord(createdUser);
  }

  public static async updateDatabaseUserProfile(
    userId: string,
    input: UpdateDatabaseUserProfileInput,
    env: AppBindings
  ): Promise<void> {
    const payload: Record<string, unknown> = {};

    if (typeof input.name === "string") {
      payload.name = input.name;
    }

    if (typeof input.email === "string") {
      payload.email = input.email;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    await this.managementRequest(
      env,
      `/users/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  }

  public static async sendPasswordResetEmail(email: string, env: AppBindings): Promise<void> {
    const response = await fetch(`https://${env.AUTH0_DOMAIN}/dbconnections/change_password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.AUTH0_SPA_CLIENT_ID,
        email,
        connection: env.AUTH0_CONNECTION
      })
    });

    if (!response.ok) {
      const detail = await readErrorText(response);
      throw new AppHttpError(
        500,
        "AUTH0_PASSWORD_RESET_FAILED",
        `No se pudo enviar el correo de cambio de contraseña: ${detail}`
      );
    }
  }
}
