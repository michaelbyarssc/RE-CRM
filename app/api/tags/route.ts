import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllTags, createTag } from "@/lib/actions/leads";
import { withAuth, readJson } from "@/lib/api-handler";
import { parseWith } from "@/lib/validation";

const newTagSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().max(30).optional(),
});

export const GET = withAuth(async () => {
  const tags = await getAllTags();
  return NextResponse.json(tags);
});

export const POST = withAuth(async ({ req }) => {
  const body = parseWith(newTagSchema, await readJson(req));
  const tag = await createTag(body.name, body.color || "#6B7280");
  return NextResponse.json(tag);
});
