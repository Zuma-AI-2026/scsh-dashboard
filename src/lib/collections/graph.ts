/**
 * Microsoft Graph with app-only (client-credentials) auth: MS_TENANT_ID,
 * MS_CLIENT_ID, MS_CLIENT_SECRET. RUN A creates a draft in the sender's
 * mailbox (Mail.ReadWrite); nothing is sent from here.
 * No framework imports; `fetchImpl` is injectable for tests.
 */

type Env = Record<string, string | undefined>;

export class GraphError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type GraphCredentials = { tenantId: string; clientId: string; clientSecret: string };

export function graphCredentials(env: Env): GraphCredentials | null {
  const tenantId = (env.MS_TENANT_ID ?? "").trim();
  const clientId = (env.MS_CLIENT_ID ?? "").trim();
  const clientSecret = (env.MS_CLIENT_SECRET ?? "").trim();
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

export async function graphToken(c: GraphCredentials, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new GraphError(`Microsoft sign-in failed: check MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET (${(json.error_description ?? `HTTP ${res.status}`).split("\n")[0].slice(0, 160)})`, res.status);
  }
  return json.access_token;
}

export type DraftMessage = { sender: string; to: string[]; cc: string[]; replyTo: string | null; subject: string; html: string };

const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

export function draftPayload(m: DraftMessage): Record<string, unknown> {
  return {
    subject: m.subject,
    body: { contentType: "HTML", content: m.html },
    toRecipients: recipients(m.to),
    ccRecipients: recipients(m.cc),
    ...(m.replyTo ? { replyTo: recipients([m.replyTo]) } : {}),
  };
}

/** POST /users/{sender}/messages → a draft in the sender's Drafts folder. */
export async function createDraft(c: GraphCredentials, m: DraftMessage, fetchImpl: typeof fetch = fetch): Promise<{ id: string; webLink: string | null }> {
  const token = await graphToken(c, fetchImpl);
  const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(m.sender)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(draftPayload(m)),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; webLink?: string; error?: { code?: string; message?: string } };
  if (res.status === 401 || res.status === 403) {
    throw new GraphError(`Microsoft rejected the sender ${m.sender}: check the Mail.ReadWrite permission, admin consent and the mailbox access policy.`, res.status);
  }
  if (res.status === 404) throw new GraphError(`Microsoft has no mailbox ${m.sender}.`, res.status);
  if (!res.ok || !json.id) throw new GraphError(`Microsoft error ${res.status}: ${(json.error?.message ?? "no draft returned").slice(0, 200)}`, res.status);
  return { id: json.id, webLink: json.webLink ?? null };
}
