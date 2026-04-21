import { NextRequest, NextResponse } from "next/server";
import { getEventById, updateEvent, deleteEvent } from "@/lib/actions/calendar";
import { autoSyncEvent, autoDeleteFromGoogle } from "@/lib/google-calendar";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await getEventById(Number(id));
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(event);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getAuthenticatedUser();
  const { id } = await params;
  const body = await req.json();
  const event = await updateEvent(Number(id), body);

  // Immediately push update to Google Calendar
  if (event) autoSyncEvent({ ...event, userId: authUser.effectiveId });

  return NextResponse.json(event);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getAuthenticatedUser();
  const { id } = await params;

  // Get event first to check for Google ID before deleting
  const event = await getEventById(Number(id));
  await deleteEvent(Number(id));

  // Immediately delete from Google Calendar
  if (event) autoDeleteFromGoogle(event.googleEventId, authUser.effectiveId);

  return NextResponse.json({ ok: true });
}
