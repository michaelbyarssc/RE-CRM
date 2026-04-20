import { NextRequest, NextResponse } from "next/server";
import { getSequence, updateSequence, deleteSequence, addStep, updateStep, deleteStep } from "@/lib/actions/sequences";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const seq = await getSequence(Number(id));
  if (!seq) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(seq);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  if (body.action === "addStep") {
    const step = await addStep(Number(id), body.step);
    return NextResponse.json(step);
  }

  if (body.action === "updateStep") {
    await updateStep(body.stepId, body.data);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "deleteStep") {
    await deleteStep(body.stepId);
    return NextResponse.json({ ok: true });
  }

  await updateSequence(Number(id), body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteSequence(Number(id));
  return NextResponse.json({ ok: true });
}
