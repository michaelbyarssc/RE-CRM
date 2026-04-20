import { NextRequest, NextResponse } from "next/server";
import { getLeads, bulkUpdateStatus, bulkAddTag, bulkDeleteLeads } from "@/lib/actions/leads";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || undefined;
  const status = searchParams.get("status") || undefined;
  const tagId = searchParams.get("tagId") ? Number(searchParams.get("tagId")) : undefined;
  const page = searchParams.get("page") ? Number(searchParams.get("page")) : 1;
  const pageSize = searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : 50;

  const result = await getLeads({ search, status, tagId, page, pageSize });
  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { action, ids, status, tagId } = body;

  if (action === "updateStatus" && ids && status) {
    await bulkUpdateStatus(ids, status);
    return NextResponse.json({ ok: true });
  }

  if (action === "addTag" && ids && tagId) {
    await bulkAddTag(ids, tagId);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete" && ids) {
    await bulkDeleteLeads(ids);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.propertyAddress || !body.propertyAddress.trim()) {
      return NextResponse.json(
        { error: "Property address is required" },
        { status: 400 }
      );
    }

    const [newLead] = await db
      .insert(leads)
      .values({
        firstName: body.firstName?.trim() || null,
        lastName: body.lastName?.trim() || null,
        propertyAddress: body.propertyAddress.trim(),
        propertyCity: body.propertyCity?.trim() || null,
        propertyState: body.propertyState?.trim() || null,
        propertyZip: body.propertyZip?.trim() || null,
        mailingAddress: body.mailingAddress?.trim() || null,
        mailingCity: body.mailingCity?.trim() || null,
        mailingState: body.mailingState?.trim() || null,
        mailingZip: body.mailingZip?.trim() || null,
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        status: body.status || "new",
        source: "manual",
      })
      .returning();

    return NextResponse.json(newLead, { status: 201 });
  } catch (error) {
    console.error("Failed to create lead:", error);
    return NextResponse.json(
      { error: "Failed to create lead" },
      { status: 500 }
    );
  }
}
