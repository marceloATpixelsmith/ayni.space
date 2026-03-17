// Cloudflare Turnstile middleware for Express
// Usage: app.use(turnstileVerifyMiddleware) on public entry points
import axios from "axios";

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_ENABLED = process.env.TURNSTILE_ENABLED === "true";

export async function verifyTurnstileToken(token: string, remoteip?: string): Promise<boolean> {
  if (!TURNSTILE_ENABLED) return true; // Bypass if not enabled
  if (!TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_SECRET_KEY not set");
  if (!token) return false;
  try {
    const resp = await axios.post(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      new URLSearchParams({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        ...(remoteip ? { remoteip } : {}),
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return !!resp.data.success;
  } catch (err) {
    return false;
  }
}

export function turnstileVerifyMiddleware(req, res, next) {
  if (!TURNSTILE_ENABLED) return next();
  const token = req.body["cf-turnstile-response"] || req.headers["cf-turnstile-response"];
  verifyTurnstileToken(token, req.ip)
    .then((ok) => {
      if (!ok) {
        res.status(403).json({ error: "Turnstile verification failed" });
      } else {
        next();
      }
    })
    .catch(() => {
      res.status(500).json({ error: "Turnstile verification error" });
    });
}
