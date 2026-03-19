import type { RequestHandler } from "express";

function getSentryIngestOrigin() {
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) {
    return null;
  }

  try {
    const parsed = new URL(dsn);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Lightweight security headers without external runtime dependency.
 * Keeps the API server bootable in constrained environments.
 */
export function securityHeaders(): RequestHandler {
  const sentryOrigin = getSentryIngestOrigin();

  return (_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

    const connectSrc = ["'self'", ...(sentryOrigin ? [sentryOrigin] : [])].join(" ");

    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "img-src 'self' data: https:",
        "script-src 'self' 'unsafe-inline' https:",
        "style-src 'self' 'unsafe-inline' https:",
        `connect-src ${connectSrc}`,
      ].join("; "),
    );

    next();
  };
}
