import { NextRequest, NextResponse } from "next/server";
import { getEvents, createEvent } from "@/lib/actions/calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const type = searchParams.get("type") || undefined;
  const status = searchParams.get("status") || undefined;

  if (!start || !end) {
    return NextResponse.json(
      { error: "start and end query params are required" },
      { status: 400 }
    );
  }

  const events = await getEvents({ start, end, type, status });
  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.title || !body.startAt || !body.eventType) {
    return NextResponse.json(
      { error: "title, startAt, and eventType are required" },
      { status: 400 }
    );
  }

  const event = await createEvent(body);
  return NextResponse.json(event);
}
