import { NextResponse } from "next/server";
import { z } from "zod";
import { importLeads } from "@/lib/actions/leads";
import { withAuth, readJson } from "@/lib/api-handler";
import { parseWith } from "@/lib/validation";

const importSchema = z.object({
  data: z.array(z.record(z.string(), z.string().nullable())).min(1),
  mapping: z.record(z.string(), z.string()),
  filename: z.string().min(1).max(255),
});

export const POST = withAuth(async ({ req }) => {
  const { data, mapping, filename } = parseWith(importSchema, await readJson(req));
  // A null cell reads as an empty one.
  const rows = data.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ""]))
  );
  const result = await importLeads(rows, mapping, filename);
  return NextResponse.json(result);
});
