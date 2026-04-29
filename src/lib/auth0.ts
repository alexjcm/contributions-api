import type { AppBindings } from "../types/app";
import { AppHttpError } from "./errors";

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

export class Auth0ManagementAPI {
  /**
   * Obtiene un token M2M usando Client Credentials.
   * Lo cachea en memoria a nivel del Isolate para reutilizarlo en múltiples peticiones.
   */
  private static async getAccessToken(env: AppBindings): Promise<string> {
    const now = Date.now();
    // Añadimos un buffer de 1 minuto (60000ms) para evitar tokens a punto de expirar
    if (cachedToken && tokenExpiresAt > now + 60000) {
      return cachedToken;
    }

    const response = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.AUTH0_M2M_CLIENT_ID,
        client_secret: env.AUTH0_M2M_CLIENT_SECRET,
        audience: env.AUTH0_M2M_AUDIENCE,
        grant_type: "client_credentials"
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[Auth0] Error obteniendo token M2M:", err);
      throw new AppHttpError(500, "AUTH0_M2M_ERROR", "Error de conexión con el proveedor de identidades.");
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    cachedToken = data.access_token;
    tokenExpiresAt = now + data.expires_in * 1000;

    return cachedToken;
  }

  /**
   * Busca si un usuario ya existe en Auth0 mediante su email.
   */
  public static async getUserByEmail(email: string, env: AppBindings): Promise<string | null> {
    const token = await this.getAccessToken(env);
    console.log(`[Auth0] Fetching user by email: ${email}`);
    
    // Auth0 endpoints for users-by-email require the exact email
    const url = new URL(`https://${env.AUTH0_DOMAIN}/api/v2/users-by-email`);
    url.searchParams.set("email", email);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[Auth0] Error buscando usuario por email:", err);
      throw new AppHttpError(500, "AUTH0_M2M_ERROR", "No se pudo validar el correo en el proveedor de identidades.");
    }

    const users = await response.json() as Array<{ user_id: string }>;
    if (users && users.length > 0) {
      return users[0].user_id; // Ya existe
    }

    return null;
  }

  /**
   * Genera una contraseña segura aleatoria de alta entropía que cumple con todas
   * las políticas estrictas de Auth0 (mayúsculas, minúsculas, números, caracteres especiales y longitud).
   */
  private static generateSecureTempPassword(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    // Convert to base64 and clean up unsafe URL chars just in case, though it doesn't matter for a password
    let base = btoa(String.fromCharCode(...bytes)).replace(/[/+=]/g, '');
    // Ensure it complies with Auth0 strict policy
    return base + "A1!a";
  }

  /**
   * Crea un usuario nuevo en Auth0.
   */
  public static async createUser(email: string, name: string, env: AppBindings): Promise<string> {
    const token = await this.getAccessToken(env);
    console.log(`[Auth0] Creating new user: ${email}`);
    
    const securePassword = this.generateSecureTempPassword();

    const response = await fetch(`https://${env.AUTH0_DOMAIN}/api/v2/users`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        name,
        password: securePassword,
        connection: env.AUTH0_CONNECTION,
        verify_email: false // Se verificará automáticamente con el ticket de cambio de contraseña
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[Auth0] Error creando usuario:", err);
      throw new AppHttpError(500, "AUTH0_M2M_ERROR", "No se pudo crear el acceso en el proveedor de identidades.");
    }

    const user = await response.json() as { user_id: string };
    return user.user_id;
  }

  /**
   * Envía un correo de restablecimiento de contraseña utilizando la Authentication API.
   * Esto dispara la plantilla nativa de Auth0 directamente al correo del usuario.
   */
  public static async sendPasswordResetEmail(email: string, env: AppBindings): Promise<void> {
    console.log(`[Auth0] Sending password reset email to: ${email}`);
    const response = await fetch(`https://${env.AUTH0_DOMAIN}/dbconnections/change_password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: env.AUTH0_M2M_CLIENT_ID,
        email: email,
        connection: env.AUTH0_CONNECTION
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[Auth0] Error enviando correo de restablecimiento:", err);
      throw new AppHttpError(500, "AUTH0_M2M_ERROR", "No se pudo enviar el correo de acceso al usuario.");
    }
  }

  /**
   * Elimina un usuario en Auth0.
   */
  public static async deleteUser(userId: string, env: AppBindings): Promise<void> {
    const token = await this.getAccessToken(env);
    console.log(`[Auth0] Eliminando usuario: ${userId}`);

    const response = await fetch(`https://${env.AUTH0_DOMAIN}/api/v2/users/${userId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Auth0] Error eliminando usuario ${userId}:`, err);
      throw new AppHttpError(500, "AUTH0_M2M_ERROR", "No se pudo eliminar el acceso antiguo en el proveedor de identidades.");
    }
  }

  /**
   * Actualiza propiedades de un usuario en Auth0 (ej. nombre).
   */
  public static async updateUser(userId: string, data: { name?: string }, env: AppBindings): Promise<void> {
    const token = await this.getAccessToken(env);
    console.log(`[Auth0] Actualizando usuario ${userId} con datos:`, data);

    const response = await fetch(`https://${env.AUTH0_DOMAIN}/api/v2/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Auth0] Error actualizando usuario ${userId}:`, err);
      throw new AppHttpError(500, "AUTH0_M2M_ERROR", "No se pudieron actualizar los datos en el proveedor de identidades.");
    }
  }
}
