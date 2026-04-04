const IPQS_EMAIL_API_BASE = "https://ipqualityscore.com/api/json/email";

export type SignupRiskDecision = "allow" | "step_up" | "block";

export type SignupRiskAssessment = {
  decision: SignupRiskDecision;
  reason: "score" | "disposable_email" | "undeliverable_email" | "suspicious_ip" | "ipqs_failure";
  score: number | null;
  disposable: boolean;
  undeliverable: boolean;
  suspiciousIp: boolean;
  providerFailed: boolean;
};

function parsePositive(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseIpqsResponse(payload: Record<string, unknown>) {
  const fraudScore = typeof payload["fraud_score"] === "number" ? payload["fraud_score"] : null;
  const disposable = payload["disposable"] === true;
  const valid = payload["valid"] === true;
  const smtpScore = typeof payload["smtp_score"] === "number" ? payload["smtp_score"] : null;
  const recentAbuse = payload["recent_abuse"] === true;
  const vpn = payload["vpn"] === true;
  const tor = payload["tor"] === true;

  const undeliverable = valid === false || (smtpScore !== null && smtpScore < 0.2);
  const suspiciousIp = recentAbuse || vpn || tor;
  return { fraudScore, disposable, undeliverable, suspiciousIp };
}

export async function assessSignupRiskWithIpqs(email: string, ipAddress: string | null | undefined): Promise<SignupRiskAssessment> {
  const apiKey = process.env["IPQS_API_KEY"]?.trim();
  const timeoutMs = parsePositive(process.env["IPQS_TIMEOUT_MS"], 2000);
  const stepUpThreshold = parsePositive(process.env["IPQS_STEP_UP_THRESHOLD"], 75);

  if (!apiKey) {
    return {
      decision: "step_up",
      reason: "ipqs_failure",
      score: null,
      disposable: false,
      undeliverable: false,
      suspiciousIp: false,
      providerFailed: true,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`${IPQS_EMAIL_API_BASE}/${encodeURIComponent(apiKey)}/${encodeURIComponent(email)}`);
    if (ipAddress) url.searchParams.set("ip_address", ipAddress);

    const response = await fetch(url.toString(), { method: "GET", signal: controller.signal });
    if (!response.ok) throw new Error(`ipqs_http_${response.status}`);
    const payload = (await response.json()) as Record<string, unknown>;
    const parsed = parseIpqsResponse(payload);

    if (parsed.disposable) {
      return { decision: "block", reason: "disposable_email", score: parsed.fraudScore, disposable: true, undeliverable: parsed.undeliverable, suspiciousIp: parsed.suspiciousIp, providerFailed: false };
    }
    if (parsed.undeliverable) {
      return { decision: "step_up", reason: "undeliverable_email", score: parsed.fraudScore, disposable: parsed.disposable, undeliverable: true, suspiciousIp: parsed.suspiciousIp, providerFailed: false };
    }
    if ((parsed.fraudScore ?? 0) >= stepUpThreshold || parsed.suspiciousIp) {
      return { decision: "step_up", reason: parsed.suspiciousIp ? "suspicious_ip" : "score", score: parsed.fraudScore, disposable: parsed.disposable, undeliverable: parsed.undeliverable, suspiciousIp: parsed.suspiciousIp, providerFailed: false };
    }
    return { decision: "allow", reason: "score", score: parsed.fraudScore, disposable: parsed.disposable, undeliverable: parsed.undeliverable, suspiciousIp: parsed.suspiciousIp, providerFailed: false };
  } catch {
    return {
      decision: "step_up",
      reason: "ipqs_failure",
      score: null,
      disposable: false,
      undeliverable: false,
      suspiciousIp: false,
      providerFailed: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
