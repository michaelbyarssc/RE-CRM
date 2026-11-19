import { NextResponse } from "next/server";
import { z } from "zod";
import { importLeads } from "@/lib/actions/leads";
import { withAuth, readJson } from "@/lib/api-handler";
import { parseWith } from "@/lib/validation";

// The CSV parser on the import page puts the cells of a row that is longer
// than the header row into a list under "__parsed_extra". Those cells have
// no column name, so they are accepted here and then dropped.
const cellSchema = z.union([z.string(), z.null(), z.array(z.string().nullable()).max(1000)]);

const importSchema = z.object({
  data: z.array(z.record(z.string(), cellSchema)).min(1),
  mapping: z.record(z.string(), z.string()),
  filename: z.string().min(1).max(255),
});

export const POST = withAuth(async ({ req }) => {
  const { data, mapping, filename } = parseWith(importSchema, await readJson(req));
  // A null cell reads as an empty one; a list of extra cells is dropped.
  const rows = data.map((row) =>
    Object.fromEntries(
      Object.entries(row).flatMap(([k, v]): [string, string][] =>
        Array.isArray(v) ? [] : [[k, v ?? ""]]
      )
    )
  );
  const result = await importLeads(rows, mapping, filename);
  return NextResponse.json(result);
});
