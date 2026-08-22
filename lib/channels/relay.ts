import { smoobuProvider } from "@/lib/channels/smoobu-provider";
import { channexBookingIdFromExternalId, sendBookingMessage } from "@/lib/channels/channex-messages";
import { uploadChannexAttachment } from "@/lib/channels/channex-attachments";

// The single place a guest message gets pushed back to whichever channel the
// booking came from.
//
// This exists because the relay used to be hand-copied into each outbound
// path, and every copy only knew about Smoobu. When Channex was added, only
// deliverAiMessage was updated - so a host's own reply, the retry button, and
// the access-code message all silently stopped at the database for a Channex
// booking. Channex bookings carry no guest email either, so those guests could
// not be reached at all, including with their door code.
//
// Callers get an outcome rather than an exception, and decide for themselves
// what to record or surface: "skipped" is a normal resting state (a direct
// booking has no channel; some OTAs have no message API), while "failed" is
// the only case worth flagging to a host.

export type RelayOutcome =
  // attachmentSkipped is only ever true on the Smoobu path - their message
  // API has no attachment support at all (confirmed against their docs), so
  // a photo attached to a Smoobu-routed reply still sends its text but never
  // reaches the guest on that channel. Omitted (not false) when no
  // attachment was requested, or when the channel is Channex - Channex sends
  // text and attachment together in the one call, so if that call
  // succeeded, the attachment was part of it.
  | { status: "sent"; provider: "smoobu" | "channex"; attachmentSkipped?: boolean }
  | { status: "skipped"; reason: string }
  | { status: "failed"; provider: "smoobu" | "channex"; error: string };

export interface RelayTarget {
  externalId: string | null;
  ownerId: string;
}

// attachmentDataUrl: a single data:<mime>;base64,... string, as produced by
// a browser FileReader. Channex's send-message call takes at most one
// attachment id per call - matched here rather than inventing multi-
// attachment support their API doesn't have.
export async function relayMessageToChannel(
  target: RelayTarget,
  body: string,
  attachmentDataUrl?: string
): Promise<RelayOutcome> {
  const externalId = target.externalId;
  if (!externalId) return { status: "skipped", reason: "Direct booking - no channel to relay to" };

  if (externalId.startsWith("smoobu-")) {
    try {
      await smoobuProvider.sendGuestMessage(target.ownerId, externalId, body);
      return { status: "sent", provider: "smoobu", attachmentSkipped: !!attachmentDataUrl };
    } catch (err) {
      return { status: "failed", provider: "smoobu", error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (externalId.startsWith("channex-")) {
    const bookingId = channexBookingIdFromExternalId(externalId);
    if (!bookingId) return { status: "skipped", reason: "Channex reservation with no recoverable booking id" };
    try {
      const attachmentId = attachmentDataUrl ? await uploadChannexAttachment(attachmentDataUrl) : undefined;
      await sendBookingMessage(bookingId, body, attachmentId);
      return { status: "sent", provider: "channex" };
    } catch (err) {
      // 422 not_supported means this booking's OTA has no message API at all,
      // so no retry can ever succeed and there is nothing for a host to act
      // on. Reporting it as a failure would fire on every single message for
      // such a channel.
      const e = err as { status?: number; code?: string };
      if (e.status === 422 && e.code === "not_supported") {
        return { status: "skipped", reason: "This booking's OTA does not support messaging" };
      }
      return { status: "failed", provider: "channex", error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { status: "skipped", reason: `Unrecognised channel for externalId "${externalId}"` };
}
