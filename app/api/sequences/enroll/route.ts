import { NextRequest, NextResponse } from "next/server";
import { enrollLeads } from "@/lib/actions/sequences";

export async function POST(req: NextRequest) {
  const body = await req.json();
  await enrollLeads(body.leadIds, body.sequenceId);
  return NextResponse.json({ ok: true });
}
