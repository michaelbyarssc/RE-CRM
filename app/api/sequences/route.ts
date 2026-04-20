import { NextRequest, NextResponse } from "next/server";
import { getSequences, createSequence } from "@/lib/actions/sequences";

export async function GET() {
  const sequences = await getSequences();
  return NextResponse.json(sequences);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const seq = await createSequence(body.name, body.description || "");
  return NextResponse.json(seq);
}
