import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { MessageSquare, Bot, AlertTriangle } from "lucide-react";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/utils";
import { MessagesAutoSync } from "@/components/messages/MessagesAutoSync";

export default async function MessagesPage() {
  const session = await auth();

  // Get latest message per reservation (unified inbox)
  const conversations = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session!.user.id },
      messages: { some: {} },
    },
    include: {
      guest: true,
      property: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: {
        select: {
          messages: {
            where: { isRead: false, direction: "INBOUND" },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Sort by the latest MESSAGE, not the reservation row's updatedAt — that
  // field also changes on every Smoobu sync (price, dates, status), which
  // could bump a conversation to the top with no new message at all.
  conversations.sort((a, b) => {
    const at = a.messages[0]?.createdAt ? new Date(a.messages[0].createdAt).getTime() : 0;
    const bt = b.messages[0]?.createdAt ? new Date(b.messages[0].createdAt).getTime() : 0;
    return bt - at;
  });

  // Conversations where the AI couldn't answer a guest question
  const flagged = await prisma.message.findMany({
    where: {
      needsHostReply: true,
      direction: "INBOUND",
      reservation: { property: { ownerId: session!.user.id } },
    },
    select: { reservationId: true },
  });
  const needsReplySet = new Set(flagged.map((f) => f.reservationId));

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
          <p className="text-slate-500 text-sm mt-0.5">Unified inbox from all channels</p>
        </div>
        <div className="mt-1.5"><MessagesAutoSync /></div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {conversations.length === 0 && (
          <div className="text-center py-16">
            <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">No messages yet</p>
          </div>
        )}
        {conversations.map((conv) => {
          const lastMsg = conv.messages[0];
          const unreadCount = conv._count.messages;
          const nights = Math.round((conv.checkOut.getTime() - conv.checkIn.getTime()) / 86400000);
          return (
            <Link key={conv.id} href={`/reservations/${conv.id}`}>
              <div className={`flex items-start gap-3 p-4 md:p-5 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${unreadCount > 0 ? "bg-indigo-50/50" : ""}`}>
                <div className="relative flex-shrink-0">
                  <div
                    className="w-11 h-11 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-semibold text-[13px]"
                    title={`${nights} night${nights === 1 ? "" : "s"}`}
                  >
                    🌙{nights}
                  </div>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-medium text-sm truncate ${unreadCount > 0 ? "text-slate-900" : "text-slate-700"}`}>
                      {conv.guest.name}
                    </p>
                    {lastMsg && (
                      <p className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
                        {new Date(lastMsg.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{conv.property.name}</p>
                  {lastMsg && (
                    <p className={`text-sm truncate mt-1 ${unreadCount > 0 && lastMsg.direction === "INBOUND" ? "font-medium text-slate-800" : "text-slate-500"}`}>
                      {lastMsg.direction === "OUTBOUND" ? "You: " : ""}{lastMsg.body}
                    </p>
                  )}
                  <div className="flex items-center flex-wrap gap-1.5 mt-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_COLORS[conv.source]}`}>
                      {SOURCE_LABELS[conv.source]}
                    </span>
                    {lastMsg?.isAiGenerated && (
                      <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Bot className="w-3 h-3" />AI
                      </span>
                    )}
                    {needsReplySet.has(conv.id) && (
                      <span className="text-xs text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Needs your reply
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
