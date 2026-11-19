import { NextResponse } from "next/server";
import { z } from "zod";
import { enrollLeads } from "@/lib/actions/sequences";
import { withAuth, readJson } from "@/lib/api-handler";
import { idListSchema, idSchema, parseWith } from "@/lib/validation";

const enrollSchema = z.object({ leadIds: idListSchema, sequenceId: idSchema });

export const POST = withAuth(async ({ req }) => {
  const body = parseWith(enrollSchema, await readJson(req));
  await enrollLeads(body.leadIds, body.sequenceId);
  return NextResponse.json({ ok: true });
});
