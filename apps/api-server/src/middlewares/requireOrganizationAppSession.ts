import type { NextFunction, Request, Response } from "express";
import { getAppBySlug } from "../lib/appAccess.js";
import { resolveNormalizedAccessProfile } from "../lib/appAccessProfile.js";

export async function requireOrganizationAppSession(req: Request, res: Response, next: NextFunction) {
  const sessionAppSlug = req.session?.appSlug;
  if (!sessionAppSlug) {
    res.status(403).json({ error: "Organization flow is unavailable for this session." });
    return;
  }

  const sessionApp = await getAppBySlug(sessionAppSlug);
  if (!sessionApp) {
    res.status(403).json({ error: "Organization flow is unavailable for this session." });
    return;
  }

  const normalizedAccessProfile = resolveNormalizedAccessProfile(sessionApp);
  if (normalizedAccessProfile !== "organization") {
    res.status(403).json({ error: "Organization flow is unavailable for this app." });
    return;
  }

  next();
}
