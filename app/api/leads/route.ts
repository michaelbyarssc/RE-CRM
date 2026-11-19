import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getLeads,
  bulkUpdateStatus,
  bulkAddTag,
  bulkDeleteLeads,
  leadStatusSchema,
} from "@/lib/actions/leads";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { withAuth, readJson } from "@/lib/api-handler";
import { BadRequestError } from "@/lib/errors";
import { idListSchema, idSchema, optionalText, parseId, parseWith } from "@/lib/validation";

const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("updateStatus"), ids: idListSchema, status: leadStatusSchema }),
  z.object({ action: z.literal("addTag"), ids: idListSchema, tagId: idSchema }),
  z.object({ action: z.literal("delete"), ids: idListSchema }),
]);

// The fields a new lead may have. userId always comes from the session.
const newLeadSchema = z.object({
  firstName: optionalText(200),
  lastName: optionalText(200),
  propertyAddress: z.string().trim().min(1).max(500),
  propertyCity: optionalText(200),
  propertyState: optionalText(100),
  propertyZip: optionalText(20),
  mailingAddress: optionalText(500),
  mailingCity: optionalText(200),
  mailingState: optionalText(100),
  mailingZip: optionalText(20),
  phone: optionalText(50),
  email: optionalText(320),
  status: leadStatusSchema.optional(),
});

/** A positive whole number from the query string, or the default when absent. */
function positiveInt(value: string | null, fallback: number) {
  return value === null ? fallback : parseId(value);
}

export const GET = withAuth(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.slice(0, 200) || undefined;
  const status = sp.get("status")?.slice(0, 50) || undefined;
  const tagId = sp.get("tagId") ? parseId(sp.get("tagId")) : undefined;
  const page = positiveInt(sp.get("page"), 1);
  // Larger page sizes are capped by getLeads (MAX_PAGE_SIZE).
  const pageSize = positiveInt(sp.get("pageSize"), 50);

  const result = await getLeads({ search, status, tagId, page, pageSize });
  return NextResponse.json(result);
});

export const PATCH = withAuth(async ({ req }) => {
  const parsed = bulkSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new BadRequestError("Invalid action");
  const body = parsed.data;

  if (body.action === "updateStatus") await bulkUpdateStatus(body.ids, body.status);
  else if (body.action === "addTag") await bulkAddTag(body.ids, body.tagId);
  else await bulkDeleteLeads(body.ids);

  return NextResponse.json({ ok: true });
});

export const POST = withAuth(async ({ req, user }) => {
  const body = parseWith(newLeadSchema, await readJson(req));

  const [newLead] = await db
    .insert(leads)
    .values({
      userId: user.effectiveId,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      propertyAddress: body.propertyAddress,
      propertyCity: body.propertyCity ?? null,
      propertyState: body.propertyState ?? null,
      propertyZip: body.propertyZip ?? null,
      mailingAddress: body.mailingAddress ?? null,
      mailingCity: body.mailingCity ?? null,
      mailingState: body.mailingState ?? null,
      mailingZip: body.mailingZip ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      status: body.status || "new",
      source: "manual",
    })
    .returning();

  return NextResponse.json(newLead, { status: 201 });
});
