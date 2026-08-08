import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { translateTemplateText } from "@/lib/translate";
import { MERGE_FIELDS } from "@/lib/templates";

// POST { id, targetLanguage } — duplicates a template, translating its
// subject and body into targetLanguage (e.g. "English"). The duplicate is
// created INACTIVE: it must never start sending to real guests before the
// host has reviewed the translation for accuracy, especially the merge-field
// tokens, which a mistranslation could otherwise silently break.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, targetLanguage } = await req.json();
  if (!id || !targetLanguage?.trim()) {
    return NextResponse.json({ error: "id and targetLanguage required" }, { status: 400 });
  }

  const original = await prisma.messageTemplate.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!original) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  try {
    const [translatedSubject, translatedBody] = await Promise.all([
      translateTemplateText(original.subject, targetLanguage),
      translateTemplateText(original.body, targetLanguage),
    ]);

    // Every merge-field token present in the source must survive verbatim in
    // the translation — flagged here rather than silently trusted, since a
    // mangled token means guests would literally see "[Full Name]" or similar
    // in their message instead of their name.
    const droppedTokens = MERGE_FIELDS.filter(
      (f) => original.body.includes(f.token) && !translatedBody.includes(f.token)
    ).map((f) => f.token);

    const duplicate = await prisma.messageTemplate.create({
      data: {
        userId: session.user.id,
        name: `${original.name} (${targetLanguage})`,
        trigger: original.trigger,
        offsetDays: original.offsetDays,
        sendHour: original.sendHour,
        subject: translatedSubject,
        body: translatedBody,
        active: false, // review before this can send to a real guest
        propertyId: original.propertyId,
      },
    });

    return NextResponse.json({ template: duplicate, droppedTokens }, { status: 201 });
  } catch (err) {
    console.error("Failed to duplicate + translate template:", err);
    return NextResponse.json({ error: "Translation failed — try again in a moment." }, { status: 502 });
  }
}
