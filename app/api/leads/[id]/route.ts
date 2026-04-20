import { NextRequest, NextResponse } from "next/server";
import { getLead, updateLead, updateLeadStatus, addTagToLead, removeTagFromLead } from "@/lib/actions/leads";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lead = await getLead(Number(id));
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(lead);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  if (body.action === "addTag") {
    await addTagToLead(Number(id), body.tagId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "removeTag") {
    await removeTagFromLead(Number(id), body.tagId);
    return NextResponse.json({ ok: true });
  }

  if (body.status) {
    await updateLeadStatus(Number(id), body.status);
  }

  const { action, tagId, ...data } = body;
  if (Object.keys(data).length > 0) {
    await updateLead(Number(id), data);
  }

  return NextResponse.json({ ok: true });
}
