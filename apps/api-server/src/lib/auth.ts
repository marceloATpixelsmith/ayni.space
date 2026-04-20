import { getGlobalSettingSnapshot, GLOBAL_SETTING_KEYS, refreshRuntimeCache } from "./runtimeSettings.js";
import { OAuth2Client } from "google-auth-library";

function getRequiredEnv(name: string): string
{
  const value = process.env[name];

  if (!value)
  {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

export function getGoogleClient(): OAuth2Client
{
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getRequiredEnv("GOOGLE_CLIENT_SECRET");
  void refreshRuntimeCache();
  const redirectUri = String(getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.GOOGLE_REDIRECT_URI, getRequiredEnv("GOOGLE_REDIRECT_URI")));

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function buildGoogleAuthUrl(state: string): string
{
  const client = getGoogleClient();

  return client.generateAuthUrl(
  {
    access_type: "offline",
    scope:
    [
      "openid",
      "email",
      "profile",
    ],
    state,
    prompt: "consent",
  });
}

export async function exchangeCodeForUser(code: string)
{
  const client = getGoogleClient();

  const { tokens } = await client.getToken(code);

  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: getRequiredEnv("GOOGLE_CLIENT_ID"),
  });

  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email) {
    throw new Error("Google user payload is missing required fields");
  }

  if (!payload.email_verified) {
    throw new Error("Google account email is not verified");
  }

  // Hosted domain enforcement (if configured)
  const hostedDomain = process.env["GOOGLE_HOSTED_DOMAIN"];
  if (hostedDomain && payload.hd !== hostedDomain) {
    throw new Error(`Google account must belong to hosted domain: ${hostedDomain}`);
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
    hd: payload.hd ?? null,
  };
}