import { OAuth2Client } from "google-auth-library";

const GOOGLE_CLIENT_ID = process.env["GOOGLE_CLIENT_ID"];
const GOOGLE_CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"];
const GOOGLE_REDIRECT_URI = process.env["GOOGLE_REDIRECT_URI"];

// Create Google OAuth2 client — requires env vars at runtime
export function getGoogleClient(): OAuth2Client {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required for Google OAuth"
    );
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// Build the Google OAuth authorization URL
export function buildGoogleAuthUrl(state: string): string {
  const client = getGoogleClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });
}

export interface GoogleUserInfo {
  sub: string; // Google unique user ID
  email: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

// Exchange code for tokens and fetch user info
export async function exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
  const client = getGoogleClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload) {
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
