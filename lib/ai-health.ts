import { prisma } from "@/lib/prisma";
import { sendAiHealthAlert } from "@/lib/notifications";

// How long to wait before sending another alert email for the same account,
// so a burst of failures (or a long outage) doesn't flood the owner's inbox.
const ALERT_DEBOUNCE_MS = 30 * 60 * 1000; // 30 minutes

export type AiErrorType = "rate_limit" | "billing" | "auth" | "overloaded" | "other";

export interface ClassifiedAiError {
  type: AiErrorType;
  status?: number;
  // Plain-language explanation + what the owner should do about it
  title: string;
  hint: string;
  // Whether this failure warrants an email alert to the owner
  alert: boolean;
}

// Turn a thrown Anthropic SDK error into something a non-engineer can act on.
// These are the API's OWN limits (billed per-token via the console key) — they
// have nothing to do with any Claude Pro / claude.ai subscription.
export function classifyAiError(err: unknown): ClassifiedAiError {
  const e = err as { status?: number; error?: { type?: string }; message?: string };
  const status = e?.status;
  const apiType = e?.error?.type;
  const msg = e?.message || "";

  if (status === 429 || apiType === "rate_limit_error") {
    return {
      type: "rate_limit",
      status,
      title: "API rate limit reached",
      hint: "Too many requests/tokens per minute for your usage tier. It usually clears within a minute. To raise the ceiling, increase your usage tier in the Anthropic console → Limits.",
      alert: true,
    };
  }
  if (status === 400 && /credit|billing|balance|quota|spend/i.test(msg)) {
    return {
      type: "billing",
      status,
      title: "Out of API credits / spend cap hit",
      hint: "Your prepaid balance is exhausted or the monthly spend cap was reached. Top up or raise the cap in the Anthropic console → Billing. Turn on auto-reload so this never happens again.",
      alert: true,
    };
  }
  if (apiType === "billing_error") {
    return {
      type: "billing",
      status,
      title: "Billing problem on your Anthropic account",
      hint: "Anthropic rejected the request for a billing reason (credits, spend cap, or payment method). Check the Anthropic console → Billing.",
      alert: true,
    };
  }
  if (status === 401 || apiType === "authentication_error") {
    return {
      type: "auth",
      status,
      title: "API key rejected",
      hint: "The ANTHROPIC_API_KEY is missing, wrong, or was revoked. Set a valid key in Railway → Variables.",
      alert: true,
    };
  }
  if (status === 529 || apiType === "overloaded_error") {
    return {
      type: "overloaded",
      status,
      title: "Anthropic temporarily overloaded",
      hint: "Anthropic's API is briefly overloaded. This is on their side and normally clears on its own; the assistant retries automatically.",
      alert: false,
    };
  }
  return {
    type: "other",
    status,
    title: "AI reply failed",
    hint: msg ? msg.slice(0, 200) : "The AI request failed for an unexpected reason.",
    alert: false,
  };
}

// Rate-limit headroom Anthropic returns on every response.
export interface RateLimitSnapshot {
  reqRemaining?: number | null;
  tokensRemaining?: number | null;
  tokensLimit?: number | null;
  resetAt?: Date | null;
}

export function readRateLimitHeaders(headers: Headers): RateLimitSnapshot {
  const num = (v: string | null) => (v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null);
  // Anthropic uses the combined input+output token budget for the tightest limit
  const reset =
    headers.get("anthropic-ratelimit-tokens-reset") ||
    headers.get("anthropic-ratelimit-requests-reset");
  return {
    reqRemaining: num(headers.get("anthropic-ratelimit-requests-remaining")),
    tokensRemaining: num(headers.get("anthropic-ratelimit-tokens-remaining")),
    tokensLimit: num(headers.get("anthropic-ratelimit-tokens-limit")),
    resetAt: reset ? new Date(reset) : null,
  };
}

// Record a successful AI call + the current rate-limit headroom. Best-effort:
// never let health bookkeeping break the actual reply flow.
export async function recordAiSuccess(userId: string, rl?: RateLimitSnapshot): Promise<void> {
  try {
    const data = {
      status: "ok",
      lastSuccessAt: new Date(),
      reqRemaining: rl?.reqRemaining ?? undefined,
      tokensRemaining: rl?.tokensRemaining ?? undefined,
      tokensLimit: rl?.tokensLimit ?? undefined,
      resetAt: rl?.resetAt ?? undefined,
    };
    await prisma.aiHealth.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  } catch (err) {
    console.error("[ai-health] recordAiSuccess failed:", err);
  }
}

// Record a failed AI call, and email the owner if it's an actionable outage
// (rate limit / credits / bad key) and we haven't alerted them recently.
export async function recordAiFailure(userId: string, err: unknown): Promise<ClassifiedAiError> {
  const info = classifyAiError(err);
  try {
    const existing = await prisma.aiHealth.findUnique({ where: { userId } });
    await prisma.aiHealth.upsert({
      where: { userId },
      create: {
        userId,
        status: "error",
        lastErrorAt: new Date(),
        lastErrorType: info.type,
        lastErrorMessage: info.title,
      },
      update: {
        status: "error",
        lastErrorAt: new Date(),
        lastErrorType: info.type,
        lastErrorMessage: info.title,
      },
    });

    const dueForAlert =
      !existing?.lastAlertAt || Date.now() - existing.lastAlertAt.getTime() > ALERT_DEBOUNCE_MS;
    if (info.alert && dueForAlert) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (user?.email) {
        try {
          await sendAiHealthAlert({
            ownerEmail: user.email,
            ownerName: user.name,
            title: info.title,
            hint: info.hint,
            errorType: info.type,
          });
          await prisma.aiHealth.update({ where: { userId }, data: { lastAlertAt: new Date() } });
        } catch (mailErr) {
          console.error("[ai-health] alert email failed:", mailErr);
        }
      }
    }
  } catch (dbErr) {
    console.error("[ai-health] recordAiFailure failed:", dbErr);
  }
  return info;
}
