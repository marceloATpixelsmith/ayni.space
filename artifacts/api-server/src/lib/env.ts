// Strict environment variable validation at startup
const REQUIRED_ENV_VARS = [
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "ALLOWED_ORIGINS",
  "STRIPE_WEBHOOK_SECRET",
  // Add more as needed
];

export function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
