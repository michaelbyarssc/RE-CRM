import { NextResponse } from "next/server";
import { z } from "zod";
import { getSequences, createSequence } from "@/lib/actions/sequences";
import { withAuth, readJson } from "@/lib/api-handler";
import { parseWith } from "@/lib/validation";

const newSequenceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});

export const GET = withAuth(async () => {
  const sequences = await getSequences();
  return NextResponse.json(sequences);
});

export const POST = withAuth(async ({ req }) => {
  const body = parseWith(newSequenceSchema, await readJson(req));
  const seq = await createSequence(body.name, body.description || "");
  return NextResponse.json(seq);
});
