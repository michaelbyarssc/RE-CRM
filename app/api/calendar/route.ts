import { NextResponse } from "next/server";
import { z } from "zod";
import { getEvents, createEvent } from "@/lib/actions/calendar";
import { autoSyncEvent } from "@/lib/google-calendar";
import { withAuth, readJson } from "@/lib/api-handler";
import { parseWith } from "@/lib/validation";

const rangeSchema = z.object({
  start: z.string().min(1).max(40),
  end: z.string().min(1).max(40),
  type: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
});

export const GET = withAuth(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const query = {
    start: sp.get("start") ?? undefined,
    end: sp.get("end") ?? undefined,
    type: sp.get("type") || undefined,
    status: sp.get("status") || undefined,
  };

  if (!query.start || !query.end) {
    return NextResponse.json(
      { error: "start and end query params are required" },
      { status: 400 }
    );
  }

  const events = await getEvents(parseWith(rangeSchema, query));
  return NextResponse.json(events);
});

export const POST = withAuth(async ({ req }) => {
  // createEvent checks the fields and that a linked lead or buyer is the caller's.
  const event = await createEvent(await readJson(req));

  // Immediately push to Google Calendar (event has userId from createEvent)
  autoSyncEvent(event);

  return NextResponse.json(event);
});
