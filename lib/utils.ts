import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "EUR"): string {
  const code = (currency || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown/invalid ISO code → show the code before the number so it's never wrong
    return `${code} ${Math.round(amount).toLocaleString()}`;
  }
}

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", options || { month: "short", day: "numeric", year: "numeric" });
}

export function formatShortDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function nightsBetween(checkIn: Date | string, checkOut: Date | string): number {
  const d1 = typeof checkIn === "string" ? new Date(checkIn) : checkIn;
  const d2 = typeof checkOut === "string" ? new Date(checkOut) : checkOut;
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export const SOURCE_COLORS: Record<string, string> = {
  BOOKING: "bg-blue-100 text-blue-700",
  AIRBNB: "bg-rose-100 text-rose-700",
  VRBO: "bg-green-100 text-green-700",
  EXPEDIA: "bg-yellow-100 text-yellow-700",
  DIRECT: "bg-purple-100 text-purple-700",
};

export const SOURCE_LABELS: Record<string, string> = {
  BOOKING: "Booking.com",
  AIRBNB: "Airbnb",
  VRBO: "VRBO",
  EXPEDIA: "Expedia",
  DIRECT: "Direct",
};

export const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  CONFIRMED: "bg-green-100 text-green-700",
  CHECKED_IN: "bg-blue-100 text-blue-700",
  CHECKED_OUT: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-red-100 text-red-700",
  NO_SHOW: "bg-orange-100 text-orange-700",
};
