import { db, auditLogsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import type { Request } from "express";

interface AuditOptions {
  orgId?: string;
  userId?: string;
  userEmail?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
}

// Write an audit log entry — fire and forget (non-blocking)
export function writeAuditLog(opts: AuditOptions): void {
  const ipAddress = opts.req?.ip;
  const userAgent = opts.req?.get("user-agent");

  db.insert(auditLogsTable)
    .values({
      id: randomUUID(),
      orgId: opts.orgId ?? null,
      userId: opts.userId ?? null,
      userEmail: opts.userEmail ?? null,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId ?? null,
      metadata: opts.metadata ?? null,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    })
    .catch((err: unknown) => {
      console.error("Failed to write audit log:", err);
    });
}
