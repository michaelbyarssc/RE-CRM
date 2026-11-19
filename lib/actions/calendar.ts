import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { calendarEvents, leads, buyers } from "@/lib/db/schema";
import { eq, and, gte, lte, lt, or } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { EVENT_TYPES, EVENT_STATUSES } from "@/lib/constants";
import { NotFoundError } from "@/lib/errors";
import { idSchema, parseWith } from "@/lib/validation";

const EVENT_TYPE_VALUES = EVENT_TYPES.map((t) => t.value) as [string, ...string[]];
const EVENT_STATUS_VALUES = EVENT_STATUSES.map((s) => s.value) as [string, ...string[]];

// "YYYY-MM-DD", optionally followed by a time. Stored as sent (local time).
const dateTime = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);

// The event fields a client may send. googleEventId and syncStatus are set
// by the Google sync code only; userId always comes from the session.
const eventFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000).nullable().optional(),
  eventType: z.enum(EVENT_TYPE_VALUES),
  startAt: dateTime,
  endAt: dateTime.nullable().optional(),
  allDay: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  location: z.string().max(500).nullable().optional(),
  status: z.enum(EVENT_STATUS_VALUES).optional(),
  leadId: idSchema.nullable().optional(),
  buyerId: idSchema.nullable().optional(),
};
const createEventSchema = z.object(eventFields);
const updateEventSchema = z.object(eventFields).partial();

/** A lead or buyer linked to an event must belong to the caller (404 otherwise). */
async function assertOwnLinks(userId: string, leadId?: number | null, buyerId?: number | null) {
  if (leadId) {
    const [lead] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, userId))).limit(1);
    if (!lead) throw new NotFoundError("Lead not found");
  }
  if (buyerId) {
    const [buyer] = await db.select({ id: buyers.id }).from(buyers)
      .where(and(eq(buyers.id, buyerId), eq(buyers.userId, userId))).limit(1);
    if (!buyer) throw new NotFoundError("Buyer not found");
  }
}

// Join conditions that only ever attach the caller's own lead or buyer, so an
// old event that points at someone else's row shows no details from it.
const ownLead = (userId: string) => and(eq(calendarEvents.leadId, leads.id), eq(leads.userId, userId));
const ownBuyer = (userId: string) => and(eq(calendarEvents.buyerId, buyers.id), eq(buyers.userId, userId));

export async function getEvents(params: {
  start: string;
  end: string;
  type?: string;
  status?: string;
}) {
  const authUser = await getAuthenticatedUser();

  // Normalize date range to consistent local time strings for comparison
  const normalizedStart = params.start.length === 10 ? params.start + "T00:00:00" : params.start.slice(0, 19);
  const normalizedEnd = params.end.length === 10 ? params.end + "T23:59:59" : params.end.slice(0, 19);

  const conditions = [
    eq(calendarEvents.userId, authUser.effectiveId),
    or(
      and(gte(calendarEvents.startAt, normalizedStart), lt(calendarEvents.startAt, normalizedEnd)),
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
    .leftJoin(leads, ownLead(authUser.effectiveId))
    .leftJoin(buyers, ownBuyer(authUser.effectiveId))
    .where(and(...conditions))
    .orderBy(calendarEvents.startAt);

  return events;
}

export async function getEventById(id: number) {
  const authUser = await getAuthenticatedUser();

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
    .leftJoin(leads, ownLead(authUser.effectiveId))
    .leftJoin(buyers, ownBuyer(authUser.effectiveId))
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, authUser.effectiveId)));

  return event || null;
}

/** Create an event for the caller. `input` is untrusted and checked here. */
export async function createEvent(input: unknown) {
  const authUser = await getAuthenticatedUser();
  const data = parseWith(createEventSchema, input);
  await assertOwnLinks(authUser.effectiveId, data.leadId, data.buyerId);

  const [event] = await db
    .insert(calendarEvents)
    .values({
      userId: authUser.effectiveId,
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

/**
 * Update one of the caller's events. `input` is untrusted: only the client
 * fields are accepted, and a new lead or buyer must be the caller's.
 * Throws NotFoundError when the event is not the caller's.
 */
export async function updateEvent(id: number, input: unknown) {
  const authUser = await getAuthenticatedUser();
  const data = parseWith(updateEventSchema, input);
  await assertOwnLinks(authUser.effectiveId, data.leadId, data.buyerId);

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

  const [event] = await db
    .update(calendarEvents)
    .set(updateData)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, authUser.effectiveId)))
    .returning();

  if (!event) throw new NotFoundError("Event not found");
  return event;
}

export async function deleteEvent(id: number) {
  const authUser = await getAuthenticatedUser();
  await db.delete(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, authUser.effectiveId)));
}

export async function getUpcomingEvents(limit = 5) {
  const authUser = await getAuthenticatedUser();

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
    .leftJoin(leads, ownLead(authUser.effectiveId))
    .leftJoin(buyers, ownBuyer(authUser.effectiveId))
    .where(
      and(
        eq(calendarEvents.userId, authUser.effectiveId),
        gte(calendarEvents.startAt, now),
        eq(calendarEvents.status, "scheduled")
      )
    )
    .orderBy(calendarEvents.startAt)
    .limit(limit);

  return events;
}
