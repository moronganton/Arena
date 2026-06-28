"use client";
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, Download } from "lucide-react";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/utils";
import Link from "next/link";

interface Reservation {
  id: string;
  checkIn: string;
  checkOut: string;
  status: string;
  source: string;
  guest: { name: string };
  property: { id: string; name: string; city: string };
}

interface CalendarBlock {
  id: string;
  startDate: string;
  endDate: string;
  reason?: string;
  property: { id: string; name: string };
}

function getDaysInMonth(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Date[] = [];

  // Pad with previous month days
  const startPad = firstDay.getDay();
  for (let i = startPad - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  // Current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  // Pad with next month days
  const endPad = 6 - lastDay.getDay();
  for (let i = 1; i <= endPad; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const days = getDaysInMonth(year, month);

  useEffect(() => {
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 0).toISOString();
    setLoading(true);
    fetch(`/api/calendar?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => {
        setReservations(data.reservations || []);
        setBlocks(data.blocks || []);
        setLoading(false);
      });
  }, [year, month]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function getReservationsForDay(date: Date): Reservation[] {
    return reservations.filter((r) => {
      const ci = new Date(r.checkIn);
      const co = new Date(r.checkOut);
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const checkIn = new Date(ci.getFullYear(), ci.getMonth(), ci.getDate());
      const checkOut = new Date(co.getFullYear(), co.getMonth(), co.getDate());
      return d >= checkIn && d < checkOut;
    });
  }

  function isBlocked(date: Date): boolean {
    return blocks.some((b) => {
      const s = new Date(b.startDate);
      const e = new Date(b.endDate);
      return date >= s && date <= e;
    });
  }

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
        <div className="flex items-center gap-3">
          <a
            href="/api/calendar?format=ical"
            download="calendar.ics"
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-indigo-600 border border-slate-200 px-3 py-2 rounded-xl hover:border-indigo-200 transition"
          >
            <Download className="w-4 h-4" />
            Export iCal
          </a>
          <Link
            href="/reservations/new"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Block Dates
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {/* Calendar Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-slate-100 transition">
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h2 className="font-bold text-slate-900 text-lg">
            {monthNames[month]} {year}
          </h2>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-slate-100 transition">
            <ChevronRight className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Day names */}
        <div className="grid grid-cols-7 border-b border-slate-100">
          {dayNames.map((d) => (
            <div key={d} className="text-center text-xs font-semibold text-slate-500 py-3">
              {d}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        {loading ? (
          <div className="py-20 text-center text-slate-400">Loading...</div>
        ) : (
          <div className="grid grid-cols-7">
            {days.map((day, idx) => {
              const isCurrentMonth = day.getMonth() === month;
              const isToday = day.toDateString() === today.toDateString();
              const dayReservations = getReservationsForDay(day);
              const blocked = isBlocked(day);

              return (
                <div
                  key={idx}
                  className={`min-h-24 p-2 border-b border-r border-slate-50 last:border-r-0 ${
                    !isCurrentMonth ? "bg-slate-50/50" : ""
                  } ${blocked && isCurrentMonth ? "bg-red-50" : ""}`}
                >
                  <span
                    className={`inline-flex w-7 h-7 items-center justify-center rounded-full text-sm mb-1 ${
                      isToday
                        ? "bg-indigo-600 text-white font-bold"
                        : isCurrentMonth
                        ? "text-slate-900"
                        : "text-slate-400"
                    }`}
                  >
                    {day.getDate()}
                  </span>

                  {blocked && isCurrentMonth && (
                    <div className="text-xs bg-red-100 text-red-600 rounded px-1 py-0.5 mb-1 truncate">
                      Blocked
                    </div>
                  )}

                  <div className="space-y-0.5">
                    {dayReservations.slice(0, 3).map((r) => {
                      const isStart = new Date(r.checkIn).toDateString() === day.toDateString();
                      return (
                        <Link key={r.id} href={`/reservations/${r.id}`}>
                          <div className={`text-xs px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 ${
                            SOURCE_COLORS[r.source] || "bg-indigo-100 text-indigo-700"
                          }`}>
                            {isStart ? `▶ ${r.guest.name}` : r.guest.name}
                          </div>
                        </Link>
                      );
                    })}
                    {dayReservations.length > 3 && (
                      <div className="text-xs text-slate-500">+{dayReservations.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-slate-600">
        {["BOOKING","AIRBNB","VRBO","EXPEDIA","DIRECT"].map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded ${SOURCE_COLORS[s]}`}></span>
            {SOURCE_LABELS[s]}
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-red-100"></span>
          Blocked
        </div>
      </div>
    </div>
  );
}
