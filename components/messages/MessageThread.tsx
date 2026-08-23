"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, RefreshCw, AlertTriangle, Reply, X, BookOpen, Check, StickyNote, SendHorizonal, Paperclip, FileText } from "lucide-react";

interface Message {
  id: string;
  body: string;
  direction: string;
  channel: string;
  source?: string | null;
  isAiGenerated: boolean;
  isDraft?: boolean;
  needsHostReply?: boolean;
  channelFailed?: boolean;
  channelError?: string | null;
  createdAt: Date | string;
  senderId: string | null;
  detectedLanguage?: string | null;
  translatedBody?: string | null;
  // JSON string - array of data:<mime>;base64,... URLs, or null/undefined.
  attachments?: string | null;
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // matches lib/channels/channex-attachments.ts
const MAX_ATTACHMENTS_PER_MESSAGE = 10; // sanity bound - Channex sends each as its own message

function parseAttachments(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// One attachment thumbnail/link. Guests can in principle send any file type
// through Channex's attachments API, not only images - falls back to a
// download chip for anything that isn't image/*.
function AttachmentPreview({ dataUrl }: { dataUrl: string }) {
  if (dataUrl.startsWith("data:image/")) {
    return (
      <a href={dataUrl} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not a static asset next/image can optimise */}
        <img src={dataUrl} alt="Attachment" className="max-w-full rounded-lg mt-1.5 block" />
      </a>
    );
  }
  return (
    <a
      href={dataUrl}
      download
      className="mt-1.5 flex items-center gap-1.5 text-xs underline decoration-current/40 underline-offset-2"
    >
      <FileText className="w-3.5 h-3.5 shrink-0" />
      Download attachment
    </a>
  );
}

function isNonEnglish(language?: string | null): boolean {
  return !!language && language.trim().toLowerCase() !== "english";
}

// Matches the globe glyph from the approved mockup, not lucide's built-in
// "Languages" icon (a different, unrelated glyph) — kept as its own small
// component so both render sites (pill + "show translation" link) stay in sync.
function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.4 2.6 3.6 5.7 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.7-3.6-9s1.2-6.4 3.6-9z" />
    </svg>
  );
}

export function MessageThread({
  reservationId,
  initialMessages,
}: {
  reservationId: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [internalNote, setInternalNote] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [saveToKb, setSaveToKb] = useState(false);
  const [kbSaved, setKbSaved] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [dismissBusyId, setDismissBusyId] = useState<string | null>(null);
  // Messages just dismissed, still showing the "No reply needed · Undo" line
  // — cleared automatically a few seconds later, or immediately on Undo.
  const [justDismissed, setJustDismissed] = useState<Set<string>>(new Set());
  // A translation already fetched is shown by default; this only tracks the
  // ones the host explicitly collapsed back to the original.
  const [hiddenTranslations, setHiddenTranslations] = useState<Set<string>>(new Set());
  // Pending attachments (data URLs) staged for the next send - Channex sends
  // each as its own message under the hood, see lib/channels/relay.ts.
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function startReply(msg: Message) {
    setReplyTo(msg);
    // Flagged questions are exactly what the knowledge base is missing
    setSaveToKb(!!msg.needsHostReply);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark as read on mount
  useEffect(() => {
    fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservationId }),
    });
  }, [reservationId]);

  // Lazily detect language for any guest message that hasn't been checked yet
  // — lights up the translate pill on foreign-language messages, including
  // ones imported long before this feature existed. Runs once per message
  // ever, then it's cached server-side.
  useEffect(() => {
    fetch("/api/messages/detect-language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservationId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.detected?.length) return;
        const byId = new Map<string, string>(data.detected.map((d: { id: string; detectedLanguage: string }) => [d.id, d.detectedLanguage]));
        setMessages((prev) => prev.map((m) => (byId.has(m.id) ? { ...m, detectedLanguage: byId.get(m.id) } : m)));
      })
      .catch(() => {}); // best-effort — the pill just won't appear this load
  }, [reservationId]);

  async function translateMessage(id: string) {
    setTranslatingId(id);
    try {
      const res = await fetch("/api/messages/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id }),
      });
      if (res.ok) {
        const { translatedBody } = await res.json();
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, translatedBody } : m)));
        setHiddenTranslations((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } finally {
      setTranslatingId(null);
    }
  }

  // Clears the "needs your reply" flag without sending anything — for guest
  // messages like "thank you" that don't actually need an answer. Reuses the
  // same flag the dashboard's "Needs your reply" list and this bubble's rose
  // highlight already read, so nothing else has to change to reflect it.
  async function dismissNeedsReply(id: string) {
    setDismissBusyId(id);
    try {
      const res = await fetch("/api/messages/needs-reply", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, needsHostReply: false }),
      });
      if (res.ok) {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, needsHostReply: false } : m)));
        setJustDismissed((prev) => new Set(prev).add(id));
        setTimeout(() => {
          setJustDismissed((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 6000);
      }
    } finally {
      setDismissBusyId(null);
    }
  }

  async function undoDismiss(id: string) {
    setJustDismissed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, needsHostReply: true } : m)));
    await fetch("/api/messages/needs-reply", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, needsHostReply: true }),
    });
  }

  function toggleTranslation(id: string) {
    setHiddenTranslations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickAttachments(files: FileList | File[]) {
    setAttachmentError(null);
    const list = Array.from(files);
    if (pendingAttachments.length + list.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      setAttachmentError(`You can attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} photos to one message.`);
      return;
    }
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB - the limit is 5MB.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => setPendingAttachments((prev) => [...prev, reader.result as string]);
      reader.onerror = () => setAttachmentError(`Couldn't read "${file.name}" - try again.`);
      reader.readAsDataURL(file);
    }
  }

  function removeAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function sendMessage() {
    if ((!newMessage.trim() && pendingAttachments.length === 0) || sending) return;
    setSending(true);

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reservationId,
        messageBody: newMessage,
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
        internal: internalNote,
        replyToId: internalNote ? undefined : replyTo?.id,
        saveToKnowledge: internalNote ? false : saveToKb,
      }),
    });

    if (res.ok) {
      const msg = await res.json();
      // The reply clears all "needs your reply" highlights server-side
      setMessages((prev) => [
        ...prev.map((m) => (m.needsHostReply ? { ...m, needsHostReply: false } : m)),
        msg,
      ]);
      setNewMessage("");
      setPendingAttachments([]);
      setAttachmentError(null);
      setReplyTo(null);
      setSaveToKb(false);
      setInternalNote(false);
      if (msg.knowledgeSaved) {
        setKbSaved(true);
        setTimeout(() => setKbSaved(false), 4000);
      }
      if (msg.channelRelay === "failed") {
        alert(
          "Message saved, but it didn't reach the guest on Booking.com/Airbnb. " +
          "Use the Retry button on the message to try again."
        );
      } else if (msg.attachmentSkipped) {
        alert(
          "Message sent, but this guest's channel doesn't support photo attachments - " +
          "only your text reached them there. The photo is kept in this thread for your own records."
        );
      }
    }
    setSending(false);
  }

  async function refreshMessages() {
    const res = await fetch(`/api/messages?reservationId=${reservationId}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data);
    }
  }

  async function retryDelivery(id: string) {
    setRetrying(id);
    const res = await fetch("/api/messages/retry-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setRetrying(null);
    if (res.ok) {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, channelFailed: false } : m)));
    } else {
      alert("Still couldn't deliver to the booking channel. Try again shortly, or send it from Smoobu directly.");
    }
  }

  async function handleDraft(id: string, action: "approve" | "discard") {
    const res = await fetch("/api/messages/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (res.ok) {
      if (action === "discard") {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      } else {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isDraft: false } : m)));
      }
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 flex flex-col h-[560px] sm:h-[700px]">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Messages</h3>
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {messages.length}
          </span>
        </div>
        <button
          onClick={refreshMessages}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 py-8">
            <p className="text-sm">No messages yet</p>
          </div>
        )}
        {messages.map((msg) => {
          const isOutbound = msg.direction === "OUTBOUND";
          const isInternal = msg.channel === "INTERNAL";
          // Translation is offered in BOTH directions: the AI replies to
          // guests in their own language, so a message sent on the host's
          // behalf is often one they cannot read back. Internal notes are
          // excluded - the host wrote those themselves.
          const translatable = !isInternal;
          const showingTranslation = translatable && !!msg.translatedBody && !hiddenTranslations.has(msg.id);
          const canTranslate = translatable && isNonEnglish(msg.detectedLanguage) && !msg.translatedBody;
          const canReshowTranslation = translatable && !!msg.translatedBody && hiddenTranslations.has(msg.id);
          // The outbound bubble is indigo with white text, so the divider and
          // its label need light-on-dark treatment to stay legible.
          const onDarkBubble = isOutbound && !msg.isDraft && !isInternal;
          // Outbound bubbles sit on the right, so their translate controls
          // hug the right edge too instead of drifting to the far left.
          const actionAlign = isOutbound ? "ml-auto mr-1" : "ml-1";
          return (
            <div key={msg.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${isOutbound ? "order-2" : "order-1"}`}>
                {!isOutbound && (
                  <div className="flex items-center gap-1.5 mb-1 ml-1 flex-wrap">
                    <User className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-500">Guest</span>
                    {msg.needsHostReply && (
                      <span className="flex items-center gap-1 text-xs text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-full font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        Needs your reply
                      </span>
                    )}
                    <button
                      onClick={() => startReply(msg)}
                      className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-indigo-600 transition"
                      title="Reply to this message"
                    >
                      <Reply className="w-3 h-3" />
                      Reply
                    </button>
                    {msg.needsHostReply && (
                      <button
                        onClick={() => dismissNeedsReply(msg.id)}
                        disabled={dismissBusyId === msg.id}
                        className="flex items-center gap-0.5 text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-50 transition"
                        title="This message doesn't need a reply"
                      >
                        <Check className="w-3 h-3" />
                        No reply needed
                      </button>
                    )}
                  </div>
                )}
                {isOutbound && isInternal && (
                  <div className="flex items-center gap-1.5 mb-1 justify-end mr-1">
                    <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full font-medium">
                      <StickyNote className="w-3 h-3" />
                      Internal note — guest can&apos;t see this
                    </span>
                  </div>
                )}
                {isOutbound && msg.isAiGenerated && (
                  <div className="flex items-center gap-1.5 mb-1 justify-end mr-1">
                    <span className="text-xs text-indigo-500">AI Reply</span>
                    <Bot className="w-3 h-3 text-indigo-400" />
                  </div>
                )}
                {isOutbound && !msg.isAiGenerated && msg.source === "smoobu" && (
                  <div className="flex items-center gap-1.5 mb-1 justify-end mr-1">
                    <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                      sent via Smoobu
                    </span>
                  </div>
                )}
                {msg.isDraft && (
                  <div className="flex items-center gap-1.5 mb-1 justify-end mr-1">
                    <span className="text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full font-medium">
                      AI draft — not sent yet
                    </span>
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    msg.isDraft
                      ? "bg-amber-50 text-slate-800 border-2 border-dashed border-amber-300 rounded-tr-sm"
                      : isInternal
                      ? "bg-amber-100 text-amber-900 border border-amber-200 rounded-tr-sm"
                      : isOutbound
                      ? "bg-indigo-600 text-white rounded-tr-sm"
                      : msg.needsHostReply
                      ? "bg-rose-50 text-slate-800 border-2 border-rose-200 rounded-tl-sm"
                      : "bg-slate-100 text-slate-800 rounded-tl-sm"
                  }`}
                >
                  {(() => {
                    const attachmentUrls = parseAttachments(msg.attachments);
                    // A photo sent with no caption stores an empty body (so the
                    // guest-facing channel gets only the photo, not a fabricated
                    // "Sent a photo" text bubble alongside it) - shown here only,
                    // as a label rather than actual message content.
                    const bodyText = msg.body || (attachmentUrls.length > 0 ? "Sent a photo" : "");
                    return (
                      <>
                        {showingTranslation ? (
                          <>
                            <p className="whitespace-pre-wrap break-words">{bodyText}</p>
                            <div className="flex items-center gap-2 my-2">
                              <span className={`text-[10px] font-semibold tracking-wide uppercase whitespace-nowrap ${onDarkBubble ? "text-indigo-200" : "text-slate-400"}`}>
                                Translated from {msg.detectedLanguage}
                              </span>
                              <span className={`flex-1 h-px ${onDarkBubble ? "bg-indigo-400/50" : "bg-slate-200"}`} />
                            </div>
                            <p className="whitespace-pre-wrap break-words">{msg.translatedBody}</p>
                          </>
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{bodyText}</p>
                        )}
                        {attachmentUrls.map((dataUrl, i) => (
                          <AttachmentPreview key={i} dataUrl={dataUrl} />
                        ))}
                      </>
                    );
                  })()}
                </div>
                {canTranslate && (
                  <button
                    onClick={() => translateMessage(msg.id)}
                    disabled={translatingId === msg.id}
                    className={`mt-1.5 ${actionAlign} flex w-fit items-center gap-1.5 text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 px-2.5 py-1 rounded-full transition`}
                  >
                    <GlobeIcon className={`w-3 h-3 ${translatingId === msg.id ? "animate-spin" : ""}`} />
                    {translatingId === msg.id ? "Translating…" : "Translate to English"}
                  </button>
                )}
                {showingTranslation && (
                  <button
                    onClick={() => toggleTranslation(msg.id)}
                    className={`mt-1 ${actionAlign} block w-fit text-[11px] text-slate-400 hover:text-slate-600 underline decoration-slate-300 underline-offset-2 transition`}
                  >
                    Hide translation
                  </button>
                )}
                {canReshowTranslation && (
                  <button
                    onClick={() => toggleTranslation(msg.id)}
                    className={`mt-1.5 ${actionAlign} flex w-fit items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-indigo-700 transition`}
                  >
                    <GlobeIcon className="w-3 h-3" />
                    Show translation
                  </button>
                )}
                {msg.isDraft && (
                  <div className="flex gap-2 mt-2 justify-end">
                    <button
                      onClick={() => handleDraft(msg.id, "approve")}
                      className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium transition"
                    >
                      Approve & Send
                    </button>
                    <button
                      onClick={() => handleDraft(msg.id, "discard")}
                      className="text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-medium transition"
                    >
                      Discard
                    </button>
                  </div>
                )}
                {isOutbound && msg.channelFailed && !msg.isDraft && (
                  <div className="mt-1.5 flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        Not delivered to guest
                      </span>
                      <button
                        onClick={() => retryDelivery(msg.id)}
                        disabled={retrying === msg.id}
                        className="flex items-center gap-1 text-xs bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg font-medium transition"
                      >
                        {retrying === msg.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <SendHorizonal className="w-3 h-3" />}
                        Retry
                      </button>
                    </div>
                    {msg.channelError && (
                      <span className="text-[10px] text-rose-400 max-w-[75%] text-right">{msg.channelError}</span>
                    )}
                  </div>
                )}
                {!isOutbound && justDismissed.has(msg.id) && (
                  <div className="flex items-center gap-1.5 mt-1 ml-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <Check className="w-3 h-3" />
                      No reply needed
                    </span>
                    <button
                      onClick={() => undoDismiss(msg.id)}
                      className="text-xs text-slate-400 hover:text-slate-600 underline decoration-slate-300 underline-offset-2 transition"
                    >
                      Undo
                    </button>
                  </div>
                )}
                <p className={`text-xs text-slate-400 mt-1 ${isOutbound ? "text-right mr-1" : "ml-1"}`}>
                  {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  {new Date(msg.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="p-3 border-t border-slate-100">
        {/* Quoted message being replied to (WhatsApp-style) */}
        {replyTo && (
          <div className="mb-2 flex items-start gap-2 bg-slate-50 border-l-4 border-indigo-400 rounded-lg px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-indigo-600 mb-0.5 flex items-center gap-1">
                <Reply className="w-3 h-3" />
                Replying to guest
              </p>
              <p className="text-xs text-slate-600 truncate">{replyTo.body}</p>
            </div>
            <button
              onClick={() => { setReplyTo(null); setSaveToKb(false); }}
              className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {replyTo && (
          <label className="flex items-center gap-2 mb-2 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saveToKb}
              onChange={(e) => setSaveToKb(e.target.checked)}
              className="accent-indigo-600 w-3.5 h-3.5"
            />
            <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
            Save question &amp; answer to the knowledge base — the AI will answer it by itself next time
          </label>
        )}
        {kbSaved && (
          <p className="mb-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            Saved to the knowledge base — similar questions will now be answered automatically.
          </p>
        )}
        <div className="flex items-center gap-2 mb-2">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={internalNote}
              onChange={(e) => setInternalNote(e.target.checked)}
              className="accent-amber-500 w-3.5 h-3.5"
            />
            <StickyNote className="w-3.5 h-3.5 text-amber-500" />
            Internal note (not visible to the guest)
          </label>
        </div>
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((dataUrl, i) => (
              <div key={i} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL preview */}
                <img src={dataUrl} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-200" />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 bg-slate-700 text-white rounded-full p-0.5 hover:bg-slate-900"
                  title="Remove this photo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && (
          <p className="mb-2 text-xs text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{attachmentError}</p>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) pickAttachments(e.target.files);
              e.target.value = ""; // lets the same file be picked again after removal
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach photos"
            className="shrink-0 border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-indigo-600 rounded-xl px-3 transition"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={internalNote ? "Type a private note — the guest won't see it..." : "Type a message... (Enter to send)"}
            className={`flex-1 resize-none border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 max-h-32 ${
              internalNote
                ? "border-amber-300 bg-amber-50 focus:ring-amber-400"
                : "border-slate-200 focus:ring-indigo-500"
            }`}
            rows={2}
          />
          <button
            onClick={sendMessage}
            disabled={sending || (!newMessage.trim() && pendingAttachments.length === 0)}
            className={`disabled:opacity-50 text-white rounded-xl px-4 py-2.5 transition flex items-center gap-2 ${
              internalNote ? "bg-amber-500 hover:bg-amber-600" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
