import { NextResponse } from "next/server";
import { getSequence, updateSequence, deleteSequence, addStep, updateStep, deleteStep } from "@/lib/actions/sequences";
import { withAuth, readJsonObject } from "@/lib/api-handler";
import { NotFoundError } from "@/lib/errors";
import { idSchema, parseId, parseWith } from "@/lib/validation";

export const GET = withAuth<{ id: string }>(async ({ params }) => {
  const seq = await getSequence(parseId(params.id));
  if (!seq) throw new NotFoundError();
  return NextResponse.json(seq);
});

// The step and sequence functions keep only their allowed fields; the
// sequence id always comes from the URL, checked against the caller.
export const PATCH = withAuth<{ id: string }>(async ({ req, params }) => {
  const id = parseId(params.id);
  const body = await readJsonObject(req);

  if (body.action === "addStep") {
    const step = await addStep(id, body.step);
    return NextResponse.json(step);
  }

  if (body.action === "updateStep") {
    await updateStep(parseWith(idSchema, body.stepId), body.data, id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "deleteStep") {
    await deleteStep(parseWith(idSchema, body.stepId), id);
    return NextResponse.json({ ok: true });
  }

  await updateSequence(id, body);
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth<{ id: string }>(async ({ params }) => {
  await deleteSequence(parseId(params.id));
  return NextResponse.json({ ok: true });
});
