import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatDate, formatCurrency, SOURCE_COLORS, SOURCE_LABELS, STATUS_COLORS, nightsBetween } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, Key, MessageSquare, Edit3, Mail, Phone } from "lucide-react";
import { MessageThread } from "@/components/messages/MessageThread";
import ReservationActions from "./ReservationActions";
import { AccessCodeGenerator } from "@/components/reservations/AccessCodeGenerator";
import { AccessCodeActions } from "@/components/reservations/AccessCodeActions";
import { toCetInputValue, formatCet } from "@/lib/cet";

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const { id } = await params;

  const reservation = await prisma.reservation.findFirst({
    where: { id, property: { ownerId: session!.user.id } },
    include: {
      guest: true,
      property: { include: { locks: true } },
      messages: { orderBy: { createdAt: "asc" } },
      accessCodes: {
        include: { lock: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!reservation) notFound();

  const nights = nightsBetween(reservation.checkIn, reservation.checkOut);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href="/reservations" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-4">
          <ArrowLeft className="w-4 h-4" />
          Back to Reservations
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{reservation.guest.name}</h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${SOURCE_COLORS[reservation.source]}`}>
                {SOURCE_LABELS[reservation.source]}
              </span>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[reservation.status]}`}>
                {reservation.status}
              </span>
              {reservation.confirmationCode && (
                <span className="text-xs text-slate-500">#{reservation.confirmationCode}</span>
              )}
            </div>
            {(reservation.guest.email || reservation.guest.phone) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-slate-500">
                {reservation.guest.email && (
                  <a href={`mailto:${reservation.guest.email}`} className="flex items-center gap-1 hover:text-indigo-600">
                    <Mail className="w-3.5 h-3.5" /> {reservation.guest.email}
                  </a>
                )}
                {reservation.guest.phone && (
                  <a href={`tel:${reservation.guest.phone}`} className="flex items-center gap-1 hover:text-indigo-600">
                    <Phone className="w-3.5 h-3.5" /> {reservation.guest.phone}
                  </a>
                )}
              </div>
            )}
            {reservation.specialRequests && (
              <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5 inline-block">
                <span className="font-medium">Special request:</span> {reservation.specialRequests}
              </p>
            )}
          </div>
          <ReservationActions
            id={reservation.id}
            source={reservation.source}
            status={reservation.status}
            checkIn={reservation.checkIn.toISOString()}
            checkOut={reservation.checkOut.toISOString()}
            adults={reservation.adults}
            children={reservation.children}
            totalAmount={reservation.totalAmount}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          {/* Reservation Info */}
          <div className="bg-white rounded-2xl border border-slate-100 p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Reservation Details</h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Property</dt>
                <dd className="font-medium text-slate-900">{reservation.property.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Check-in</dt>
                <dd className="font-medium text-slate-900">{formatDate(reservation.checkIn)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Check-out</dt>
                <dd className="font-medium text-slate-900">{formatDate(reservation.checkOut)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Nights</dt>
                <dd className="font-medium text-slate-900">{nights}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Guests</dt>
                <dd className="font-medium text-slate-900">
                  {reservation.adults} adults{reservation.children > 0 ? `, ${reservation.children} children` : ""}
                </dd>
              </div>
              {reservation.totalAmount && (
                <div className="flex justify-between pt-2 border-t border-slate-100">
                  <dt className="text-slate-500">Total</dt>
                  <dd className="font-bold text-slate-900">{formatCurrency(reservation.totalAmount, reservation.currency)}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Access Codes */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-400" />
                Access Codes
              </h3>
              <AccessCodeGenerator
                reservationId={reservation.id}
                guestName={reservation.guest.name}
                propertyName={reservation.property.name}
                locks={reservation.property.locks}
                externalId={reservation.externalId}
              />
            </div>
            {reservation.accessCodes.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-slate-400 text-sm">No access codes generated yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {reservation.accessCodes.map((code) => (
                  <div key={code.id} className={`rounded-xl p-3 border ${code.isActive ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono font-bold text-lg text-slate-900 tracking-widest">{code.code}</p>
                        <p className="text-xs text-slate-500">{code.lock.name}</p>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${code.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                          {code.isActive ? "Active" : "Expired"}
                        </span>
                        {code.sentToGuest && (
                          <p className="text-xs text-slate-500 mt-1">Sent to guest</p>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Valid: {formatCet(code.validFrom)} — {formatCet(code.validTo)} <span className="text-slate-400">CET</span>
                    </p>
                    <AccessCodeActions
                      accessCodeId={code.id}
                      code={code.code}
                      lockName={code.lock.name}
                      initialFrom={toCetInputValue(code.validFrom)}
                      initialTo={toCetInputValue(code.validTo)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Message Thread */}
        <div className="lg:col-span-2">
          <MessageThread reservationId={reservation.id} initialMessages={reservation.messages} />
        </div>
      </div>
    </div>
  );
}
