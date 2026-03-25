import { initSentry } from "./middlewares/observability.js";

// Deployment marker: intentionally no-op change to exercise api-server rollout.
const DEPLOYMENT_TOUCHPOINT = "2026-03-25T02:00:00Z";

function envPresence(name: string): string {
  return process.env[name] ? "present" : "missing";
}

function validateDatabaseUrl(raw: string | undefined) {
  if (!raw) {
    throw new Error("DATABASE_URL is missing. Set DATABASE_URL in the environment before startup.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is malformed. Expected a valid postgres connection URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`DATABASE_URL has invalid protocol "${parsed.protocol}". Expected postgres:// or postgresql://.`);
  }
}

async function startServer() {
  console.info("[startup] Booting API server...");
  console.info("[startup] Deployment touchpoint:", DEPLOYMENT_TOUCHPOINT);
  console.info(
    `[startup] Env presence: PORT=${envPresence("PORT")}, SESSION_SECRET=${envPresence("SESSION_SECRET")}, DATABASE_URL=${envPresence("DATABASE_URL")}, ALLOWED_ORIGINS=${envPresence("ALLOWED_ORIGINS")}`,
  );

  const rawPort = process.env["PORT"];
  if (!rawPort) {
    throw new Error("PORT environment variable is required but was not provided.");
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  validateDatabaseUrl(process.env["DATABASE_URL"]);
  console.info("[startup] DATABASE_URL format check passed.");

  console.info("[startup] Initializing Sentry (if configured)...");
  initSentry();

  console.info("[startup] Importing app module...");
  const { default: app } = await import("./app.js");
  console.info("[startup] App module imported.");

  console.info("[startup] Starting HTTP listener...");
  app.listen(port, () => {
    console.info(`[startup] Server listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("[startup] Fatal startup error.");
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
