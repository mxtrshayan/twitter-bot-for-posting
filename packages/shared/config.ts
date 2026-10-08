import "dotenv/config";
import { z } from "zod";
import { resolve } from "node:path";
const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  APP_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  DASHBOARD_PASSWORD: z.string().min(1, "Set a non-empty dashboard password"),
  HEADLESS: z.enum(["true", "false"]).default("true"),
  SLOW_MO: z.coerce.number().min(0).default(0),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().positive().default(30000),
  JOB_TIMEOUT_MS: z.coerce.number().positive().default(120000),
});
export const config = () => ({
  ...schema.parse(process.env),
  dataDir: resolve(process.env.DATA_DIR || "./data"),
});
