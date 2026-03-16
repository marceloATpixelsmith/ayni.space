import { OAuth2Client } from "google-auth-library";

function getGoogleEnv()
{
  const googleClientId = process.env["GOOGLE_CLIENT_ID"];
  const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const googleRedirectUri = process.env["GOOGLE_REDIRECT_URI"];

  if (!googleClientId || !googleClientSecret || !googleRedirectUri)
  {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required for Google OAuth"
    );
  }

  return {
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
  };
}

// CREATE GOOGLE OAUTH2 CLIENT — READ ENV VARS AT CALL TIME, NOT MODULE LOAD TIME
export function getGoogleClient(): OAuth2Client
{
  const { googleClientId, googleClientSecret, googleRedirectUri } = getGoogleEnv();

  return new OAuth2Client(
    googleClientId,
    googleClientSecret,
    googleRedirectUri
  );
}

// BUILD THE GOOGLE OAUTH AUTHORIZATION URL
export function buildGoogleAuthUrl(state: string): string
{
  const client = getGoogleClient();

  return client.generateAuthUrl(
  {
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });
}

export interface GoogleUserInfo
{
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

// EXCHANGE CODE FOR TOKENS AND FETCH USER INFO
export async function exchangeCodeForUser(code: string): Promise<GoogleUserInfo>
{
  const client = getGoogleClient();
  const { googleClientId } = getGoogleEnv();

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const ticket = await client.verifyIdToken(
  {
    idToken: tokens.id_token!,
    audience: googleClientId,
  });

  const payload = ticket.getPayload();

  if (!payload)
  {
    throw new Error("Invalid Google ID token payload");
  }

  return {
    sub: payload.sub,
    email: payload.email!,
    name: payload.name,
    picture: payload.picture,
    email_verified: payload.email_verified,
  };
}