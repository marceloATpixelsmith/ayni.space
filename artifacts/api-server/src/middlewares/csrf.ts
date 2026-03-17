// CSRF and Origin/Referer protection middleware for Express
import csrf from "csurf";

// CSRF protection using cookies (can be session-based if needed)
export const csrfProtection = csrf({
  cookie: false // Use session, not cookie
});

// Expose CSRF token for frontend
export function csrfTokenEndpoint(req, res) {
  res.json({ csrfToken: req.csrfToken() });
}

// Origin/Referer validation middleware for sensitive routes
export function originRefererProtection(allowedOrigins) {
  return (req, res, next) => {
    const origin = req.get("origin");
    const referer = req.get("referer");
    if (!origin && !referer) return next();
    const valid = [origin, referer].some((url) => {
      if (!url) return false;
      try {
        const u = new URL(url);
        return allowedOrigins.includes(u.origin);
      } catch {
        return false;
      }
    });
    if (!valid) {
      return res.status(403).json({ error: "Invalid origin or referer" });
    }
    next();
  };
}
