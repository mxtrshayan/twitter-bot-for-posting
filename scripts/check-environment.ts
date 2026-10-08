import { ZodError } from "zod";
import { config } from "../packages/shared/config";
try {
  config();
} catch (error) {
  console.error("Launchpad configuration needs attention. Update the project .env file:");
  if (error instanceof ZodError) {
    for (const issue of error.issues) {
      const field = issue.path.join(".");
      console.error(field === "DASHBOARD_PASSWORD"
        ? "  DASHBOARD_PASSWORD must not be empty."
        : `  ${field}: ${issue.message}`);
    }
  } else console.error("  Could not load configuration.");
  process.exitCode = 1;
}
