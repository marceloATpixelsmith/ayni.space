export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmailInput(value: string): string | null {
  const normalized = normalizeEmailInput(value);
  if (!normalized) return "Email is required.";
  if (!EMAIL_PATTERN.test(normalized)) return "auth.validation.email.invalid";
  return null;
}

export function getMissingPasswordRequirements(password: string): string[] {
  const missing: string[] = [];
  if (password.length < 8)
    missing.push("Password must be at least 8 characters.");
  if (!/[A-Za-z]/.test(password))
    missing.push("Password must include at least 1 letter.");
  if (!/[A-Z]/.test(password))
    missing.push("Password must include at least 1 uppercase letter.");
  if (!/[a-z]/.test(password))
    missing.push("Password must include at least 1 lowercase letter.");
  if (!/\d/.test(password))
    missing.push("Password must include at least 1 number.");
  if (!/[^A-Za-z0-9]/.test(password))
    missing.push("Password must include at least 1 special character.");
  return missing;
}

export function validatePasswordInput(password: string): string | null {
  const [firstMissingRequirement] = getMissingPasswordRequirements(password);
  return firstMissingRequirement ?? null;
}
