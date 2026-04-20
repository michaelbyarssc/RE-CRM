import { NextResponse } from "next/server";
import { processSequences } from "@/lib/actions/sequences";

export async function POST() {
  const result = await processSequences();
  return NextResponse.json(result);
}
