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
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password must include at least 1 uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must include at least 1 lowercase letter.";
  if (!/\d/.test(password)) return "Password must include at least 1 number.";
  return null;
}
