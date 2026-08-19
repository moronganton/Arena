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
    throw new ChannexError(
      `${title}${errors?.code ? ` (${errors.code})` : ""}`,
      res.status,
      errors?.code,
      // Validation failures put the per-field reasons here; keep them, since
      // they are what makes a 422 actionable.
      errors?.details ?? (parsed === null ? text.slice(0, 300) : undefined)
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
