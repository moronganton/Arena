// Low-level Channex API access: auth, request helpers, error classification.
// Mirrors the role smoobu-core.ts plays for Smoobu.
//
// Every detail below was confirmed empirically against the staging API
// (via /api/debug/channex-probe, run from the deployment) rather than taken
// from documentation, because the development sandbox cannot reach any
// channex.io host:
//
//   - auth is the `user-api-key` header. `Authorization: Bearer` and
//     `api-key` both return 401.
//   - success responses wrap payloads as { data, meta }, where meta carries
//     pagination: { total, limit, page, order_by, order_direction }.
//   - errors come back as { errors: { code, title, details? } }.

export const CHANNEX_DEFAULT_BASE_URL = "https://staging.channex.io/api/v1";

export function channexBaseUrl(): string {
  return (process.env.CHANNEX_BASE_URL || CHANNEX_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function channexConfigured(): boolean {
  return !!process.env.CHANNEX_API_KEY;
}

// The Channex WEB app's origin, as opposed to its API base. Everything else
// here talks to `${origin}/api/v1`, but the embeddable mapping UI is served
// from the app root (`${origin}/auth/exchange?...`), so the `/api/v1` suffix
// has to come back off. Derived from the same env var rather than a second
// one, so staging vs production can never drift apart between the two.
export function channexAppOrigin(): string {
  return channexBaseUrl().replace(/\/api\/v\d+$/, "");
}

// Errors carry the HTTP status and Channex's own error object so callers can
// distinguish "retry this" (429/5xx) from "this request is wrong" (422),
// the same distinction sendSmoobuGuestMessage relies on for its retries.
export class ChannexError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ChannexError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

interface ChannexEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

async function request<T>(method: string, path: string, bodyObj?: unknown): Promise<ChannexEnvelope<T>> {
  const key = process.env.CHANNEX_API_KEY;
  if (!key) throw new ChannexError("CHANNEX_API_KEY is not set", 0, "not_configured");

  const url = `${channexBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      "user-api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (a gateway error page, say) - handled below.
  }

  if (!res.ok) {
    const errors = (parsed as { errors?: { code?: string; title?: string; details?: unknown } } | null)?.errors;
    const title = errors?.title || `Channex API error ${res.status}`;
    // A "bad_request" (as opposed to "validation_error") has been observed
    // with no `details` field at all - losing the raw body then meant the
    // real reason ("bad_request") told us nothing actionable. Always fall
    // back to the full parsed body (or raw text if it wasn't JSON) so
    // nothing Channex actually sent is ever silently dropped.
    throw new ChannexError(
      `${title}${errors?.code ? ` (${errors.code})` : ""}`,
      res.status,
      errors?.code,
      errors?.details ?? parsed ?? text.slice(0, 500)
    );
  }

  if (parsed === null) return { data: null as T };
  return parsed as ChannexEnvelope<T>;
}

export function channexGet<T = unknown>(path: string) {
  return request<T>("GET", path);
}
export function channexPost<T = unknown>(path: string, body: unknown) {
  return request<T>("POST", path, body);
}
export function channexPut<T = unknown>(path: string, body: unknown) {
  return request<T>("PUT", path, body);
}
export function channexDelete<T = unknown>(path: string) {
  return request<T>("DELETE", path);
}
