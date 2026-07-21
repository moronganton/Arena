import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { MERGE_FIELDS, TRIGGERS } from "@/lib/templates";

// GET /api/templates/schema — the merge fields and triggers the builder offers.
// Single source of truth lives in lib/templates.ts; the UI renders from this.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ fields: MERGE_FIELDS, triggers: TRIGGERS });
}
