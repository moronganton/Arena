"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface Message {
  id: string;
  body: string;
  direction: string;
  channel: string;
  source?: string | null;
  isAiGenerated: boolean;
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
  const [channel, setChannel] = useState("EMAIL");
  const bottomRef = useRef<HTMLDivElement>(null);

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
      body: JSON.stringify({ reservationId, messageBody: newMessage, channel }),
    });

    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setNewMessage("");
      if (msg.channelRelay === "failed") {
        alert(
          "Message saved, but relaying it to the booking channel (Booking.com/Airbnb) failed. " +
          "Check Railway logs for the Smoobu error, or send it from Smoobu directly."
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

  return (
    <div className="bg-white rounded-2xl border border-slate-100 flex flex-col h-[680px]">
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
          return (
            <div key={msg.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${isOutbound ? "order-2" : "order-1"}`}>
                {!isOutbound && (
                  <div className="flex items-center gap-1.5 mb-1 ml-1">
                    <User className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-500">Guest</span>
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
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    isOutbound
                      ? "bg-indigo-600 text-white rounded-tr-sm"
                      : "bg-slate-100 text-slate-800 rounded-tl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                </div>
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
        <div className="flex items-center gap-2 mb-3">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="EMAIL">Email</option>
            <option value="PLATFORM">Platform</option>
            <option value="SMS">SMS</option>
            <option value="INTERNAL">Internal Note</option>
          </select>
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
            placeholder="Type a message... (Enter to send)"
            className="flex-1 resize-none border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-32"
            rows={2}
          />
          <button
            onClick={sendMessage}
            disabled={sending || !newMessage.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl px-4 py-3 transition flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
