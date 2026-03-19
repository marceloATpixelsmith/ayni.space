import type { NextFunction, Request, Response } from "express";
import { getAppContext } from "../lib/appAccess.js";

export function requireAppAccess(appSlug: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const context = await getAppContext(userId, appSlug);
    if (!context) {
      res.status(404).json({ error: "App not found or user unavailable" });
      return;
    }

    if (!context.canAccess) {
      if (context.requiredOnboarding !== "none") {
        res.status(403).json({ error: "Onboarding required", onboarding: context.requiredOnboarding, defaultRoute: context.defaultRoute });
        return;
      }
      res.status(403).json({ error: "Unauthorized for this app" });
      return;
    }

    (req as Request & { appContext: typeof context }).appContext = context;
    next();
  };
}
