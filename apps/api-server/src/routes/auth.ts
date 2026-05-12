async function handleVerifyEmail(req: Request, res: Response) {
  ensureAuthFlowId(req);

  const token = String(req.body?.token ?? "").trim();
  const appSlug = String(req.body?.appSlug ?? "").trim();

  const continuation = resolvePostAuthContinuation({
    appSlug,
    returnPath: normalizeReturnToPath(
      firstQueryParam(req.body?.returnToPath),
    ),
    continuationType: firstQueryParam(
      req.body?.continuationType,
    ),
    orgId: firstQueryParam(req.body?.continuationOrgId),
    resourceId: firstQueryParam(
      req.body?.continuationResourceId,
    ),
  });

  const correlationId = req.correlationId;

  const logVerifyEmailOutcome = async (
    outcome: string,
    metadata?: Record<string, unknown>,
  ) => {
    await writeAuditLog({
      action: "auth.verify_email",
      resourceType: "auth_verification",
      req,
      metadata: {
        outcome,
        appSlug: appSlug || null,
        correlationId: correlationId ?? null,
        ...metadata,
      },
    });
  };

  if (!token) {
    await logVerifyEmailOutcome("invalid_request", {
      reasonCode: "missing_token",
    });

    res.status(400).json({
      error: "Invalid verification token.",
    });

    return;
  }

  const appContext =
    await resolveRequestedEmailPasswordAppContext(
      req,
      appSlug || null,
    );

  if (!appContext.success) {
    sendAppContextResolutionError(
      res,
      normalizeAuthContextFailureReason(
        appContext.reason,
      ),
    );

    return;
  }

  const app = await getAppBySlug(
    appContext.resolvedAppSlug,
  );

  if (!app) {
    res.status(400).json({
      error: "Application context could not be resolved.",
    });

    return;
  }

  const normalizedAccessProfile =
    resolveNormalizedAccessProfile(app);

  const consumed = await consumeAuthToken(
    token,
    "email_verification",
  );

  if (consumed.status !== "consumed") {
    if (consumed.status === "expired") {
      await logVerifyEmailOutcome(
        "token_rejected",
        {
          reasonCode: "expired",
        },
      );

      res.status(400).json({
        error: "Verification token has expired.",
        code: "VERIFICATION_TOKEN_EXPIRED",
      });

      return;
    }

    if (consumed.status === "already_used") {
      await logVerifyEmailOutcome(
        "token_rejected",
        {
          reasonCode: "already_used",
        },
      );

      res.status(409).json({
        error: "Verification token was already used.",
        code: "VERIFICATION_TOKEN_ALREADY_USED",
      });

      return;
    }

    await logVerifyEmailOutcome(
      "token_rejected",
      {
        reasonCode: "invalid",
      },
    );

    res.status(400).json({
      error: "Verification token is invalid.",
      code: "VERIFICATION_TOKEN_INVALID",
    });

    return;
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, consumed.token.userId),
  });

  if (!user || !user.active || user.suspended || user.deletedAt) {
    await logVerifyEmailOutcome(
      "account_unavailable",
      {
        userId: consumed.token.userId,
      },
    );

    res.status(403).json({
      error: "Account is unavailable.",
    });

    return;
  }

  if (
    normalizedAccessProfile === "superadmin" &&
    user.isSuperAdmin !== true
  ) {
    await logVerifyEmailOutcome(
      "superadmin_access_denied",
      {
        userId: consumed.token.userId,
      },
    );

    res.status(403).json({
      error: "Access denied.",
    });

    return;
  }

  await db
    .update(usersTable)
    .set({
      emailVerifiedAt: new Date(),
    })
    .where(eq(usersTable.id, consumed.token.userId));

  const mfaGate = await beginMfaPendingSession(
    req,
    user.id,
    app.slug,
    false,
  );

  if (mfaGate.required) {
    req.session.pendingPostAuthContinuation =
      continuation ?? undefined;

    await new Promise<void>((resolve, reject) => {
      req.session.save((err: unknown) =>
        err ? reject(err) : resolve(),
      );
    });

    logAuthDebug(req, "verify_email_result", {
      userId: user.id,
      appSlug: app.slug,
      mfaRequired: true,
      needsEnrollment: mfaGate.needsEnrollment,
      nextStep: mfaGate.nextStep,
      continuationType:
        continuation?.type ?? null,
      returnToPath:
        continuation?.returnPath ?? null,
    });

    await logVerifyEmailOutcome(
      "verified_mfa_required",
      {
        userId: user.id,
        needsEnrollment:
          mfaGate.needsEnrollment,
      },
    );

    res.status(202).json({
      ...buildMfaRequiredAuthResponse(
        mfaGate,
      ),
    });

    return;
  }

  await establishPasswordSession(
    req,
    user.id,
    app.slug,
    false,
  );

  await db
    .update(usersTable)
    .set({
      lastLoginAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  const nextPath =
    await resolveNextPathForEstablishedSession(
      req,
      user.id,
      app.slug,
      continuation,
    );

  if (!nextPath) {
    sendPostAuthDestinationUnresolved(
      res,
    );

    return;
  }

  logAuthDebug(req, "verify_email_result", {
    userId: user.id,
    appSlug: app.slug,
    mfaRequired: false,
    nextPath,
    continuationType:
      continuation?.type ?? null,
    returnToPath:
      continuation?.returnPath ?? null,
  });

  await logVerifyEmailOutcome(
    "verified_session_established",
    {
      userId: user.id,
      nextPath,
    },
  );

  res.json({
    success: true,
    mfaRequired: false,
    needsEnrollment: false,
    nextStep: null,
    nextPath,
  });
}
