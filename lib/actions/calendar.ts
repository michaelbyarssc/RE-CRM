"use server";

import { db } from "@/lib/db";
import { calendarEvents, leads, buyers } from "@/lib/db/schema";
import { eq, and, gte, lte, lt, or, desc, sql } from "drizzle-orm";

export async function getEvents(params: {
  start: string;
  end: string;
  type?: string;
  status?: string;
}) {
  // Normalize date range to consistent local time strings for comparison
  // FullCalendar may send date-only strings ("2026-03-30") or datetime strings
  const normalizedStart = params.start.length === 10 ? params.start + "T00:00:00" : params.start.slice(0, 19);
  const normalizedEnd = params.end.length === 10 ? params.end + "T23:59:59" : params.end.slice(0, 19);

  // Include events that:
  // 1. Start within the visible range, OR
  // 2. Span into the visible range (started before but end after range start)
  const conditions = [
    or(
      // Event starts within range (end is exclusive from FullCalendar)
      and(gte(calendarEvents.startAt, normalizedStart), lt(calendarEvents.startAt, normalizedEnd)),
      // Multi-day event spans into range
      and(lte(calendarEvents.startAt, normalizedStart), gte(calendarEvents.endAt, normalizedStart))
    ),
  ];

  if (params.type) {
    conditions.push(eq(calendarEvents.eventType, params.type));
  }
  if (params.status) {
    conditions.push(eq(calendarEvents.status, params.status));
  }

  const events = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      description: calendarEvents.description,
      eventType: calendarEvents.eventType,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      allDay: calendarEvents.allDay,
      location: calendarEvents.location,
      status: calendarEvents.status,
      leadId: calendarEvents.leadId,
      buyerId: calendarEvents.buyerId,
      googleEventId: calendarEvents.googleEventId,
      syncStatus: calendarEvents.syncStatus,
      createdAt: calendarEvents.createdAt,
      updatedAt: calendarEvents.updatedAt,
      // Lead info
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadAddress: leads.propertyAddress,
      leadCity: leads.propertyCity,
      leadState: leads.propertyState,
      leadZip: leads.propertyZip,
      leadStatus: leads.status,
      // Buyer info
      buyerName: buyers.name,
      buyerCompany: buyers.company,
      buyerPhone: buyers.phone,
      buyerEmail: buyers.email,
    })
    .from(calendarEvents)
    .leftJoin(leads, eq(calendarEvents.leadId, leads.id))
    .leftJoin(buyers, eq(calendarEvents.buyerId, buyers.id))
    .where(and(...conditions))
    .orderBy(calendarEvents.startAt);

  return events;
}

export async function getEventById(id: number) {
  const [event] = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      description: calendarEvents.description,
      eventType: calendarEvents.eventType,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      allDay: calendarEvents.allDay,
      location: calendarEvents.location,
      status: calendarEvents.status,
      leadId: calendarEvents.leadId,
      buyerId: calendarEvents.buyerId,
      googleEventId: calendarEvents.googleEventId,
      syncStatus: calendarEvents.syncStatus,
      createdAt: calendarEvents.createdAt,
      updatedAt: calendarEvents.updatedAt,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadAddress: leads.propertyAddress,
      leadCity: leads.propertyCity,
      leadState: leads.propertyState,
      leadZip: leads.propertyZip,
      leadStatus: leads.status,
      buyerName: buyers.name,
      buyerCompany: buyers.company,
      buyerPhone: buyers.phone,
      buyerEmail: buyers.email,
    })
    .from(calendarEvents)
    .leftJoin(leads, eq(calendarEvents.leadId, leads.id))
    .leftJoin(buyers, eq(calendarEvents.buyerId, buyers.id))
    .where(eq(calendarEvents.id, id));

  return event || null;
}

export async function createEvent(data: {
  title: string;
  description?: string;
  eventType: string;
  startAt: string;
  endAt?: string;
  allDay?: boolean;
  location?: string;
  status?: string;
  leadId?: number | null;
  buyerId?: number | null;
}) {
  const [event] = await db
    .insert(calendarEvents)
    .values({
      title: data.title,
      description: data.description || null,
      eventType: data.eventType,
      startAt: data.startAt,
      endAt: data.endAt || null,
      allDay: data.allDay ? 1 : 0,
      location: data.location || null,
      status: data.status || "scheduled",
      leadId: data.leadId || null,
      buyerId: data.buyerId || null,
    })
    .returning();

  return event;
}

export async function updateEvent(
  id: number,
  data: Partial<{
    title: string;
    description: string | null;
    eventType: string;
    startAt: string;
    endAt: string | null;
    allDay: boolean;
    location: string | null;
    status: string;
    leadId: number | null;
    buyerId: number | null;
    googleEventId: string | null;
    syncStatus: string | null;
  }>
) {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date().toLocaleString("sv-SE").replace(" ", "T"),
  };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.eventType !== undefined) updateData.eventType = data.eventType;
  if (data.startAt !== undefined) updateData.startAt = data.startAt;
  if (data.endAt !== undefined) updateData.endAt = data.endAt;
  if (data.allDay !== undefined) updateData.allDay = data.allDay ? 1 : 0;
  if (data.location !== undefined) updateData.location = data.location;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.leadId !== undefined) updateData.leadId = data.leadId;
  if (data.buyerId !== undefined) updateData.buyerId = data.buyerId;
  if (data.googleEventId !== undefined) updateData.googleEventId = data.googleEventId;
  if (data.syncStatus !== undefined) updateData.syncStatus = data.syncStatus;

  const [event] = await db
    .update(calendarEvents)
    .set(updateData)
    .where(eq(calendarEvents.id, id))
    .returning();

  return event;
}

export async function deleteEvent(id: number) {
  await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
}

export async function getUpcomingEvents(limit = 5) {
  // Use a date far enough in the past to catch all upcoming events
  // Since events are stored in local time and server is UTC,
  // subtract 24h to ensure we don't miss any
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  const events = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      eventType: calendarEvents.eventType,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      allDay: calendarEvents.allDay,
      location: calendarEvents.location,
      status: calendarEvents.status,
      leadId: calendarEvents.leadId,
      buyerId: calendarEvents.buyerId,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadAddress: leads.propertyAddress,
      buyerName: buyers.name,
    })
    .from(calendarEvents)
    .leftJoin(leads, eq(calendarEvents.leadId, leads.id))
    .leftJoin(buyers, eq(calendarEvents.buyerId, buyers.id))
    .where(
      and(
        gte(calendarEvents.startAt, now),
        eq(calendarEvents.status, "scheduled")
      )
    )
    .orderBy(calendarEvents.startAt)
    .limit(limit);

  return events;
}
