import { NextRequest, NextResponse } from "next/server";
import { getNotes, createNote, deleteNote } from "@/lib/actions/notes";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leadId = Number(searchParams.get("leadId"));
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const notes = await getNotes(leadId);
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const note = await createNote(body.leadId, body.content);
  return NextResponse.json(note);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteNote(id);
  return NextResponse.json({ ok: true });
}
