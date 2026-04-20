import { NextRequest, NextResponse } from "next/server";
import { getLeads, bulkUpdateStatus, bulkAddTag, bulkDeleteLeads } from "@/lib/actions/leads";

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
