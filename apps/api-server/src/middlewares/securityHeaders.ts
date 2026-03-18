import type { RequestHandler } from "express";

/**
 * Lightweight security headers without external runtime dependency.
 * Keeps the API server bootable in constrained environments.
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:"
    );
    next();
  };
}
