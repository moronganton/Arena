"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, RefreshCw, AlertTriangle, Reply, X, BookOpen, Check, StickyNote, SendHorizonal } from "lucide-react";
import { formatDate } from "@/lib/utils";

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
  const bottomRef = useRef<HTMLDivElement>(null);

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

  async function sendMessage() {
    if (!newMessage.trim() || sending) return;
    setSending(true);

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reservationId,
        messageBody: newMessage,
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
    <div className="bg-white rounded-2xl border border-slate-100 flex flex-col h-[520px] sm:h-[680px]">
      <div className="flex items-center justify-between p-5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900">Messages</h3>
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
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 py-8">
            <p className="text-sm">No messages yet</p>
          </div>
        )}
        {messages.map((msg) => {
          const isOutbound = msg.direction === "OUTBOUND";
          const isInternal = msg.channel === "INTERNAL";
          return (
            <div key={msg.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${isOutbound ? "order-2" : "order-1"}`}>
                {!isOutbound && (
                  <div className="flex items-center gap-1.5 mb-1 ml-1">
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
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                </div>
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
      <div className="p-4 border-t border-slate-100">
        {/* Quoted message being replied to (WhatsApp-style) */}
        {replyTo && (
          <div className="mb-3 flex items-start gap-2 bg-slate-50 border-l-4 border-indigo-400 rounded-lg px-3 py-2">
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
          <label className="flex items-center gap-2 mb-3 text-xs text-slate-600 cursor-pointer select-none">
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
          <p className="mb-3 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            Saved to the knowledge base — similar questions will now be answered automatically.
          </p>
        )}
        <div className="flex items-center gap-2 mb-3">
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
        <div className="flex gap-2">
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
            className={`flex-1 resize-none border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 max-h-32 ${
              internalNote
                ? "border-amber-300 bg-amber-50 focus:ring-amber-400"
                : "border-slate-200 focus:ring-indigo-500"
            }`}
            rows={2}
          />
          <button
            onClick={sendMessage}
            disabled={sending || !newMessage.trim()}
            className={`disabled:opacity-50 text-white rounded-xl px-4 py-3 transition flex items-center gap-2 ${
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
