import type { ApiError, ApiErrorDetail, ErrorStatus } from "../types/api";

export class AppHttpError extends Error {
  public readonly status: ErrorStatus;
  public readonly apiError: ApiError;

  public constructor(status: ErrorStatus, code: string, detail: string, errors?: ApiErrorDetail[]) {
    super(detail);
    this.name = "AppHttpError";
    this.status = status;
    this.apiError = { code, detail, errors };
  }
}

export const isUniqueConstraintError = (error: unknown): boolean => {
  if (!error) return false;
  
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed")) return true;
  
  // Drizzle ORM envuelve los errores de D1, por lo que el mensaje real ("UNIQUE constraint failed") 
  // suele estar oculto dentro de `error.cause`.
  if (error instanceof Error && error.cause) {
    const causeMsg = error.cause instanceof Error ? error.cause.message : String(error.cause);
    if (causeMsg.includes("UNIQUE constraint failed")) return true;
  }
  
  // Fallback escaneando toda la representación del error
  return JSON.stringify(error, Object.getOwnPropertyNames(error)).includes("UNIQUE constraint failed");
};
