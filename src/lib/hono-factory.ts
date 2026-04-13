import { Hono } from "hono";
import { createFactory } from "hono/factory";

import type { AppBindings, AppVariables } from "../types/app";

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};

export const createAppRoute = () => new Hono<AppEnv>();

// Shared factory to keep handler/middleware type inference when routes grow.
export const appFactory = createFactory<AppEnv>();
