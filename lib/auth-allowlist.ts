function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return false;

  const domains = parseList(process.env.ALLOWED_EMAIL_DOMAINS);
  const emails = parseList(process.env.ALLOWED_EMAILS);

  if (domains.length === 0 && emails.length === 0) return false;

  if (emails.includes(normalized)) return true;

  const at = normalized.lastIndexOf("@");
  const domain = normalized.slice(at + 1);
  return domains.includes(domain);
}
