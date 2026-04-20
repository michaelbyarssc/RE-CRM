import { NextRequest, NextResponse } from "next/server";
import { importLeads } from "@/lib/actions/leads";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { data, mapping, filename } = body;

  if (!data || !mapping || !filename) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await importLeads(data, mapping, filename);
  return NextResponse.json(result);
}
