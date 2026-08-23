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
  // photos attached to a Smoobu-routed reply still send the text but never
  // reach the guest on that channel. Omitted (not false) when no attachment
  // was requested, or when the channel is Channex - Channex sends each
  // attachment in its own message, so if the call as a whole succeeded,
  // every attachment was part of it.
  | { status: "sent"; provider: "smoobu" | "channex"; attachmentSkipped?: boolean }
  | { status: "skipped"; reason: string }
  | { status: "failed"; provider: "smoobu" | "channex"; error: string };

export interface RelayTarget {
  externalId: string | null;
  ownerId: string;
}

// attachmentDataUrls: data:<mime>;base64,... strings, as produced by a
// browser FileReader.
export async function relayMessageToChannel(
  target: RelayTarget,
  body: string,
  attachmentDataUrls: string[] = []
): Promise<RelayOutcome> {
  const externalId = target.externalId;
  if (!externalId) return { status: "skipped", reason: "Direct booking - no channel to relay to" };

  if (externalId.startsWith("smoobu-")) {
    // Smoobu can't carry the attachments themselves (see attachmentSkipped
    // above), so an empty caption would reach the guest as nothing at all -
    // unlike Channex, where the images themselves are the message and no
    // text is needed.
    const photoFallback =
      attachmentDataUrls.length > 1 ? `Sent ${attachmentDataUrls.length} photos` : attachmentDataUrls.length === 1 ? "Sent a photo" : "";
    const textToSend = body.trim() || photoFallback || body;
    try {
      await smoobuProvider.sendGuestMessage(target.ownerId, externalId, textToSend);
      return { status: "sent", provider: "smoobu", attachmentSkipped: attachmentDataUrls.length > 0 };
    } catch (err) {
      return { status: "failed", provider: "smoobu", error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (externalId.startsWith("channex-")) {
    const bookingId = channexBookingIdFromExternalId(externalId);
    if (!bookingId) return { status: "skipped", reason: "Channex reservation with no recoverable booking id" };
    try {
      if (attachmentDataUrls.length === 0) {
        await sendBookingMessage(bookingId, body);
      } else {
        // Channex's message-create call takes at most one attachment_id per
        // call, not an array - N photos become N consecutive messages. The
        // caption is sent as its own message, never combined with an
        // attachment_id in the same call - confirmed live, twice, that the
        // combined call reliably gets a 200 back but silently drops the
        // attachment, while an attachment-only call (empty text) reliably
        // keeps it. Matches how Booking.com's own Pulse app renders them
        // anyway: one image per bubble, separate from the text. If a later
        // photo in the batch fails, the earlier ones have already reached
        // the guest and a retry will resend them too - an acceptable
        // duplicate over losing the rest of the batch silently.
        if (body.trim()) {
          await sendBookingMessage(bookingId, body);
        }
        for (const dataUrl of attachmentDataUrls) {
          const attachmentId = await uploadChannexAttachment(dataUrl);
          await sendBookingMessage(bookingId, "", attachmentId);
        }
      }
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
