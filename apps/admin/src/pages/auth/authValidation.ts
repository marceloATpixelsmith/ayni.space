export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmailInput(value: string): string | null {
  const normalized = normalizeEmailInput(value);
  if (!normalized) return "Email is required.";
  if (!EMAIL_PATTERN.test(normalized)) return "Enter a valid email address.";
  return null;
}

export function validatePasswordInput(password: string): string | null {
  const [firstMissingRequirement] = getMissingPasswordRequirements(password);
  return firstMissingRequirement ?? null;
}

export function getMissingPasswordRequirements(password: string): string[] {
  const missing: string[] = [];
  if (password.length < 8) missing.push("Password must be at least 8 characters.");
  if (!/[A-Z]/.test(password)) missing.push("Password must include at least 1 uppercase letter.");
  if (!/[a-z]/.test(password)) missing.push("Password must include at least 1 lowercase letter.");
  if (!/\d/.test(password)) missing.push("Password must include at least 1 number.");
  return missing;
}
