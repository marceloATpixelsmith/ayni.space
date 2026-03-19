const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_ENABLED = process.env.TURNSTILE_ENABLED === "true";

export async function verifyTurnstileToken(token: string, remoteip?: string): Promise<boolean> {
  if (!TURNSTILE_ENABLED) return true;
  if (!TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_SECRET_KEY not set");
  if (!token) return false;

  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET_KEY,
      response: token,
      ...(remoteip ? { remoteip } : {}),
    });

    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!resp.ok) return false;
    const data = (await resp.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch {
    return false;
  }
}

export function turnstileVerifyMiddleware(req, res, next) {
  if (!TURNSTILE_ENABLED) {
    next();
    return;
  }

  const token = req.body["cf-turnstile-response"] || req.headers["cf-turnstile-response"];
  verifyTurnstileToken(token, req.ip)
    .then((ok) => {
      if (!ok) {
        res.status(403).json({ error: "Turnstile verification failed" });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(500).json({ error: "Turnstile verification error" });
    });
}
