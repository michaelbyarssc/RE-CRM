import { NextRequest, NextResponse } from "next/server";
import { getAllTags, createTag } from "@/lib/actions/leads";

export async function GET() {
  const tags = await getAllTags();
  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const tag = await createTag(body.name, body.color || "#6B7280");
  return NextResponse.json(tag);
}
