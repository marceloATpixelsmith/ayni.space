const REQUIRED_ENV_VARS = [
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "ALLOWED_ORIGINS",
  "STRIPE_WEBHOOK_SECRET",
  "EMAIL_CREDENTIALS_ENCRYPTION_KEY",
] as const;

function requireUrl(name: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL when provided.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${name} must use http:// or https://.`);
  }
}

function validateEncryptionKey(value: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("EMAIL_CREDENTIALS_ENCRYPTION_KEY must be exactly 64 hex characters.");
  }
}

function validateLane1ProviderEnv() {
  const provider = process.env["PLATFORM_TRANSACTIONAL_EMAIL_PROVIDER"] ?? "brevo";
  if (provider !== "brevo") {
    throw new Error(`PLATFORM_TRANSACTIONAL_EMAIL_PROVIDER must be "brevo" when set. Received: ${provider}`);
  }

  const apiKey = process.env["PLATFORM_BREVO_API_KEY"];
  if ("PLATFORM_BREVO_API_KEY" in process.env && !apiKey) {
    throw new Error("PLATFORM_BREVO_API_KEY is set but empty.");
  }

  if (process.env["NODE_ENV"] === "production" && !apiKey) {
    throw new Error("PLATFORM_BREVO_API_KEY is required in production for lane1 invitation email delivery.");
  }
}

export function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  validateEncryptionKey(process.env["EMAIL_CREDENTIALS_ENCRYPTION_KEY"] as string);
  validateLane1ProviderEnv();

  const maybeBrevoApiBase = process.env["BREVO_API_BASE_URL"];
  const maybeMailchimpApiBase = process.env["MAILCHIMP_TRANSACTIONAL_API_BASE_URL"];
  if (maybeBrevoApiBase) requireUrl("BREVO_API_BASE_URL", maybeBrevoApiBase);
  if (maybeMailchimpApiBase) requireUrl("MAILCHIMP_TRANSACTIONAL_API_BASE_URL", maybeMailchimpApiBase);

  if ("BREVO_WEBHOOK_SECRET" in process.env && !process.env["BREVO_WEBHOOK_SECRET"]) {
    throw new Error("BREVO_WEBHOOK_SECRET is set but empty.");
  }
  if ("MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY" in process.env && !process.env["MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY"]) {
    throw new Error("MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY is set but empty.");
  }
}
