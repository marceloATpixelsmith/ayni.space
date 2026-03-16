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
  const redirectUri = getRequiredEnv("GOOGLE_REDIRECT_URI");

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