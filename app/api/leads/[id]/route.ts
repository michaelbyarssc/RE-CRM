import { NextResponse } from "next/server";
import { getLead, updateLead, addTagToLead, removeTagFromLead } from "@/lib/actions/leads";
import { withAuth, readJsonObject } from "@/lib/api-handler";
import { NotFoundError } from "@/lib/errors";
import { idSchema, parseId, parseWith } from "@/lib/validation";

export const GET = withAuth<{ id: string }>(async ({ params }) => {
  const lead = await getLead(parseId(params.id));
  if (!lead) throw new NotFoundError();
  return NextResponse.json(lead);
});

export const PATCH = withAuth<{ id: string }>(async ({ req, params }) => {
  const id = parseId(params.id);
  const body = await readJsonObject(req);

  if (body.action === "addTag") {
    await addTagToLead(id, parseWith(idSchema, body.tagId));
    return NextResponse.json({ ok: true });
  }

  if (body.action === "removeTag") {
    await removeTagFromLead(id, parseWith(idSchema, body.tagId));
    return NextResponse.json({ ok: true });
  }

  // updateLead keeps only the editable fields (status included) and drops
  // everything else, such as userId, id and createdAt.
  await updateLead(id, body);

  return NextResponse.json({ ok: true });
});
