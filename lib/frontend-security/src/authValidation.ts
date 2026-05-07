import { getAuthMessage } from "@workspace/auth-ui";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmailInput(value: string): string | null {
  const normalized = normalizeEmailInput(value);
  if (!normalized) return getAuthMessage("validation_email_required");
  if (!EMAIL_PATTERN.test(normalized))
    return getAuthMessage("validation_email_invalid");
  return null;
}

export function getMissingPasswordRequirements(password: string): string[] {
  const missing: string[] = [];
  if (password.length < 8)
    missing.push(getAuthMessage("validation_password_min_length"));
  if (!/[A-Za-z]/.test(password))
    missing.push(getAuthMessage("validation_password_letter"));
  if (!/[A-Z]/.test(password))
    missing.push(getAuthMessage("validation_password_uppercase"));
  if (!/[a-z]/.test(password))
    missing.push(getAuthMessage("validation_password_lowercase"));
  if (!/\d/.test(password))
    missing.push(getAuthMessage("validation_password_number"));
  if (!/[^A-Za-z0-9]/.test(password))
    missing.push(getAuthMessage("validation_password_special"));
  return missing;
}

export function validatePasswordInput(password: string): string | null {
  const [firstMissingRequirement] = getMissingPasswordRequirements(password);
  return firstMissingRequirement ?? null;
}
