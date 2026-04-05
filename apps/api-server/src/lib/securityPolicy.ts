import type { RequestHandler } from "express";
import { requireAuth, requireSuperAdmin } from "../middlewares/requireAuth.js";
import { authRateLimiter, rateLimiter, type RateLimitOptions } from "../middlewares/rateLimit.js";
import { turnstileVerifyMiddleware } from "../middlewares/turnstile.js";

export type EndpointCategory = "PUBLIC" | "AUTHENTICATED" | "ADMIN" | "INTERNAL";

type SecurityRule = {
  method: string;
  pattern: RegExp;
  category: EndpointCategory;
  disableTurnstileReason?: string;
  rateLimit?: { type: "auth" | "default"; options?: RateLimitOptions };
};

const PRIVILEGED_ROUTE_RULES = [
  { method: "PATCH", pattern: /^\/api\/users\/[^/]+\/suspend\/?$/ },
  { method: "PATCH", pattern: /^\/api\/users\/[^/]+\/unsuspend\/?$/ },
] as const;

type SecurityConfig = {
  allowedOrigins: string[];
  failClosedDefaultCategory: Exclude<EndpointCategory, "PUBLIC">;
  rules: SecurityRule[];
};

function parseAllowedOrigins(): string[] {
  return (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getSecurityConfig(): SecurityConfig {
  return {
    allowedOrigins: parseAllowedOrigins(),
    failClosedDefaultCategory: "AUTHENTICATED",
    rules: [
      // PUBLIC
      {
        method: "POST",
        pattern: /^\/api\/auth\/google\/url\/?$/,
        category: "PUBLIC",
        rateLimit: {
          type: "auth",
          options: {
            max: Number.parseInt(process.env["AUTH_GOOGLE_URL_RATE_LIMIT_MAX"] ?? "60", 10),
            keyPrefix: "auth-google-url",
          },
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/auth\/google\/callback\/?$/,
        category: "PUBLIC",
        rateLimit: {
          type: "auth",
          options: {
            max: Number.parseInt(process.env["AUTH_GOOGLE_CALLBACK_RATE_LIMIT_MAX"] ?? "20", 10),
            keyPrefix: "auth-google-callback",
          },
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/auth\/(signup|login|forgot-password|reset-password)\/?$/,
        category: "PUBLIC",
        rateLimit: { type: "auth", options: { keyPrefix: "auth-public" } },
      },
      {
        method: "POST",
        pattern: /^\/api\/auth\/mfa\/(challenge|recovery)\/?$/,
        category: "PUBLIC",
        disableTurnstileReason: "MFA challenge and recovery use server-issued pre-auth session state; avoid requiring interactive CAPTCHA on second-factor completion.",
        rateLimit: { type: "auth", options: { keyPrefix: "auth-public" } },
      },
      {
        method: "POST",
        pattern: /^\/api\/auth\/verify-email\/?$/,
        category: "PUBLIC",
        disableTurnstileReason: "Email verification links are possession-factor proofs and must remain consumable without interactive CAPTCHA.",
        rateLimit: { type: "auth", options: { keyPrefix: "auth-public" } },
      },
      {
        method: "POST",
        pattern: /^\/api\/auth\/mfa\/enroll\/(start|verify)\/?$/,
        category: "PUBLIC",
        disableTurnstileReason: "MFA enrollment uses authenticated or pre-auth session state.",
        rateLimit: { type: "auth", options: { keyPrefix: "auth-mfa-enroll" } },
      },
      {
        method: "GET",
        pattern: /^\/api\/csrf-token\/?$/,
        category: "PUBLIC",
        disableTurnstileReason: "CSRF bootstrap endpoint must stay machine-accessible.",
      },
      {
        method: "GET",
        pattern: /^\/api\/monitoring\/config\/?$/,
        category: "PUBLIC",
      },
      {
        method: "GET",
        pattern: /^\/api\/healthz?\/?$/,
        category: "PUBLIC",
      },
      {
        method: "GET",
        pattern: /^\/healthz?\/?$/,
        category: "PUBLIC",
      },
      {
        method: "GET",
        pattern: /^\/$/,
        category: "PUBLIC",
      },
      {
        method: "POST",
        pattern: /^\/api\/monitoring\/events\/?$/,
        category: "PUBLIC",
        disableTurnstileReason: "Frontend monitoring ingest is machine-posted.",
        rateLimit: { type: "default", options: { keyPrefix: "monitoring-events" } },
      },
      {
        method: "GET",
        pattern: /^\/debug-sentry\/?$/,
        category: "INTERNAL",
      },
      // ADMIN prefix
      {
        method: "*",
        pattern: /^\/api\/admin(\/|$)/,
        category: "ADMIN",
        rateLimit: { type: "default", options: { keyPrefix: "admin" } },
      },
      // AUTH scope paths that are authenticated but sensitive
      {
        method: "POST",
        pattern: /^\/api\/auth\/logout\/?$/,
        category: "AUTHENTICATED",
        rateLimit: { type: "auth", options: { keyPrefix: "auth-logout", max: 15 } },
      },
      ...PRIVILEGED_ROUTE_RULES.map((entry) => ({
        method: entry.method,
        pattern: entry.pattern,
        category: "ADMIN" as const,
        rateLimit: { type: "default" as const, options: { keyPrefix: "admin-privileged" } },
      })),
      {
        method: "*",
        pattern: /^\/api\/users(\/|$)/,
        category: "AUTHENTICATED",
        rateLimit: { type: "default", options: { keyPrefix: "users" } },
      },
      {
        method: "*",
        pattern: /^\/api\/organizations(\/|$)/,
        category: "AUTHENTICATED",
        rateLimit: { type: "auth", options: { keyPrefix: "organizations" } },
      },
      {
        method: "*",
        pattern: /^\/api\/billing(\/|$)/,
        category: "AUTHENTICATED",
        rateLimit: { type: "default", options: { keyPrefix: "billing" } },
      },
      {
        method: "*",
        pattern: /^\/api\/invitations(\/|$)/,
        category: "AUTHENTICATED",
        rateLimit: { type: "auth", options: { keyPrefix: "invitations" } },
      },
    ],
  };
}

function resolveRule(method: string, path: string, config: SecurityConfig): SecurityRule | null {
  for (const rule of config.rules) {
    const methodMatches = rule.method === "*" || rule.method === method;
    if (methodMatches && rule.pattern.test(path)) {
      return rule;
    }
  }
  return null;
}

export function getSecurityRuleForRequest(method: string, path: string): SecurityRule | null {
  return resolveRule(method.toUpperCase(), path, getSecurityConfig());
}

export function createSecurityEnforcementMiddleware(deps: Parameters<typeof turnstileVerifyMiddleware>[0] = {}): RequestHandler {
  const config = getSecurityConfig();
  const requireTurnstile = turnstileVerifyMiddleware(deps);

  return (req, res, next) => {
    const method = req.method.toUpperCase();
    const path = req.path;
    const rule = resolveRule(method, path, config);
    const category = rule?.category ?? config.failClosedDefaultCategory;

    const handlers: RequestHandler[] = [];

    if (rule?.rateLimit) {
      handlers.push(rule.rateLimit.type === "auth" ? authRateLimiter(rule.rateLimit.options) : rateLimiter(rule.rateLimit.options));
    }

    if (category === "PUBLIC") {
      const enforceTurnstile = method === "POST" && !rule?.disableTurnstileReason;
      if (enforceTurnstile) {
        handlers.push(requireTurnstile);
      }
    } else if (category === "AUTHENTICATED") {
      handlers.push(requireAuth);
    } else if (category === "ADMIN") {
      handlers.push(requireSuperAdmin);
    } else if (category === "INTERNAL") {
      const internalToken = process.env["INTERNAL_API_TOKEN"];
      if (!internalToken || req.get("x-internal-api-token") !== internalToken) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    let index = 0;
    const run = () => {
      const current = handlers[index++];
      if (!current) {
        next();
        return;
      }
      current(req, res, run);
    };

    run();
  };
}
