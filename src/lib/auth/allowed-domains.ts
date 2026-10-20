/**
 * Company domains that may sign in without being on allowed_emails.
 * Callback also accepts any email present in public.allowed_emails.
 */
export const ALLOWED_EMAIL_DOMAINS = ["scshdev.com", "scstudenthousing.com"] as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at < 0) return false;
  const domain = normalized.slice(at + 1);
  return (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}
