import { defineConfig } from "drizzle-kit";

// Drizzle D1 config (remote via Cloudflare API). Keep tokens in environment variables.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? ""
  }
});
