import { NextResponse } from "next/server";
import { getEventById, updateEvent, deleteEvent } from "@/lib/actions/calendar";
import { autoSyncEvent, autoDeleteFromGoogle } from "@/lib/google-calendar";
import { withAuth, readJson } from "@/lib/api-handler";
import { NotFoundError } from "@/lib/errors";
import { parseId } from "@/lib/validation";

export const GET = withAuth<{ id: string }>(async ({ params }) => {
  const event = await getEventById(parseId(params.id));
  if (!event) throw new NotFoundError();
  return NextResponse.json(event);
});

export const PATCH = withAuth<{ id: string }>(async ({ req, user, params }) => {
  const id = parseId(params.id);
  const event = await updateEvent(id, await readJson(req));

  // Immediately push update to Google Calendar
  autoSyncEvent({ ...event, userId: user.effectiveId });

  return NextResponse.json(event);
});

export const DELETE = withAuth<{ id: string }>(async ({ user, params }) => {
  const id = parseId(params.id);

  // Get event first to check for Google ID before deleting
  const event = await getEventById(id);
  if (!event) throw new NotFoundError();
  await deleteEvent(id);

  // Immediately delete from Google Calendar
  autoDeleteFromGoogle(event.googleEventId, user.effectiveId);

  return NextResponse.json({ ok: true });
});
