"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { EVENT_TYPES, EVENT_STATUSES, EVENT_TYPE_MAP } from "@/lib/constants";
import { EventFormDialog } from "@/components/calendar/event-form-dialog";
import { toast } from "sonner";
import {
  CalendarDays,
  Plus,
  MapPin,
  Phone,
  Mail,
  User,
  UserCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
  Edit3,
  ExternalLink,
} from "lucide-react";
import { format, parseISO } from "date-fns";

// Dynamically import FullCalendar to avoid SSR issues
const CalendarView = dynamic(
  () => import("@/components/calendar/calendar-view").then((m) => m.CalendarView),
  {
    ssr: false,
    loading: () => (
      <div className="h-[600px] bg-muted rounded-lg flex items-center justify-center">
        Loading calendar...
      </div>
    ),
  }
);

interface CalendarEvent {
  id: number;
  title: string;
  description: string | null;
  eventType: string;
  startAt: string;
  endAt: string | null;
  allDay: number | null;
  location: string | null;
  status: string;
  leadId: number | null;
  buyerId: number | null;
  googleEventId: string | null;
  syncStatus: string | null;
  createdAt: string;
  updatedAt: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
  leadAddress: string | null;
  leadCity: string | null;
  leadState: string | null;
  leadZip: string | null;
  leadStatus: string | null;
  buyerName: string | null;
  buyerCompany: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDefaultDate, setCreateDefaultDate] = useState<string>("");
  const refreshRef = useRef<(() => void) | null>(null);

  const fetchEvents = useCallback(async (start: string, end: string) => {
    const params = new URLSearchParams({ start, end });
    const res = await fetch(`/api/calendar?${params}`);
    if (res.ok) {
      const data = await res.json();
      setEvents(data);
      return data;
    }
    return [];
  }, []);

  const handleEventClick = (eventId: number) => {
    const ev = events.find((e) => e.id === eventId);
    if (ev) {
      setSelectedEvent(ev);
      setDetailOpen(true);
    }
  };

  const handleDateClick = (dateStr: string) => {
    setCreateDefaultDate(dateStr);
    setCreateDialogOpen(true);
  };

  const handleRefresh = () => {
    refreshRef.current?.();
  };

  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    if (!confirm("Delete this event?")) return;
    await fetch(`/api/calendar/${selectedEvent.id}`, { method: "DELETE" });
    toast.success("Event deleted");
    setDetailOpen(false);
    setSelectedEvent(null);
    handleRefresh();
  };

  const handleQuickStatus = async (status: string) => {
    if (!selectedEvent) return;
    await fetch(`/api/calendar/${selectedEvent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    toast.success(`Marked as ${status}`);
    setSelectedEvent({ ...selectedEvent, status });
    handleRefresh();
  };

  // Filter events for display
  const filteredEvents = typeFilter === "all"
    ? events
    : events.filter((e) => e.eventType === typeFilter);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6" />
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Schedule appointments, callbacks, and follow-ups
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Type filter */}
          <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
            <SelectTrigger className="w-full sm:w-[160px]">
              {(() => {
                if (typeFilter === "all") return <span>All Types</span>;
                const t = EVENT_TYPES.find((t) => t.value === typeFilter);
                return (
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${t?.color}`} />
                    {t?.label ?? typeFilter}
                  </span>
                );
              })()}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {EVENT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${t.color}`} />
                    {t.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Add Event */}
          <EventFormDialog
            onEventCreated={handleRefresh}
            trigger={
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Event
              </Button>
            }
          />
        </div>
      </div>

      {/* Event type legend */}
      <div className="flex gap-3 mb-4 flex-wrap">
        {EVENT_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setTypeFilter(typeFilter === t.value ? "all" : t.value)}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors ${
              typeFilter === t.value
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${typeFilter === t.value ? "bg-white" : t.color}`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Calendar */}
      <CalendarView
        events={filteredEvents}
        onEventClick={handleEventClick}
        onDateClick={handleDateClick}
        onFetchEvents={fetchEvents}
        refreshRef={refreshRef}
      />

      {/* Create dialog for date clicks */}
      <EventFormDialog
        onEventCreated={handleRefresh}
        defaultDate={createDefaultDate}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      {/* Event Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full sm:w-[420px] overflow-y-auto">
          <SheetTitle className="sr-only">Event Details</SheetTitle>
          {selectedEvent && (
            <div className="pt-4 space-y-5">
              {/* Event header */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    className="text-xs"
                    style={{
                      backgroundColor: EVENT_TYPE_MAP[selectedEvent.eventType as keyof typeof EVENT_TYPE_MAP]?.hex || "#6B7280",
                      color: "white",
                    }}
                  >
                    {EVENT_TYPE_MAP[selectedEvent.eventType as keyof typeof EVENT_TYPE_MAP]?.label || selectedEvent.eventType}
                  </Badge>
                  <Badge
                    variant={selectedEvent.status === "completed" ? "default" : selectedEvent.status === "cancelled" ? "destructive" : "outline"}
                    className="text-xs"
                  >
                    {EVENT_STATUSES.find((s) => s.value === selectedEvent.status)?.label || selectedEvent.status}
                  </Badge>
                </div>
                <h2 className="text-lg font-semibold">{selectedEvent.title}</h2>
              </div>

              {/* Date/time */}
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p>
                    {selectedEvent.allDay
                      ? format(parseISO(selectedEvent.startAt), "EEEE, MMMM d, yyyy")
                      : format(parseISO(selectedEvent.startAt), "EEEE, MMMM d, yyyy 'at' h:mm a")}
                  </p>
                  {selectedEvent.endAt && (
                    <p className="text-muted-foreground">
                      to{" "}
                      {selectedEvent.allDay
                        ? format(parseISO(selectedEvent.endAt), "MMMM d, yyyy")
                        : format(parseISO(selectedEvent.endAt), "h:mm a")}
                    </p>
                  )}
                </div>
              </div>

              {/* Location */}
              {selectedEvent.location && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedEvent.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <MapPin className="h-4 w-4" />
                  <span>{selectedEvent.location}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {/* Description */}
              {selectedEvent.description && (
                <div className="p-3 bg-muted/30 rounded-lg text-sm">
                  {selectedEvent.description}
                </div>
              )}

              {/* Linked Lead */}
              {selectedEvent.leadId && selectedEvent.leadAddress && (
                <div className="border rounded-lg p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> Linked Lead
                  </p>
                  <p className="font-medium text-sm">
                    {[selectedEvent.leadFirstName, selectedEvent.leadLastName].filter(Boolean).join(" ") || "Unknown"}
                  </p>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      [selectedEvent.leadAddress, selectedEvent.leadCity, selectedEvent.leadState, selectedEvent.leadZip].filter(Boolean).join(", ")
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary mt-0.5 flex items-center gap-1 hover:underline"
                  >
                    <MapPin className="h-3 w-3" />
                    {selectedEvent.leadAddress}
                    {selectedEvent.leadCity && `, ${selectedEvent.leadCity}`}
                    {selectedEvent.leadState && ` ${selectedEvent.leadState}`}
                    {selectedEvent.leadZip && ` ${selectedEvent.leadZip}`}
                  </a>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedEvent.leadPhone && (
                      <a href={`tel:${selectedEvent.leadPhone}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent transition-colors">
                        <Phone className="h-3 w-3" />{selectedEvent.leadPhone}
                      </a>
                    )}
                    {selectedEvent.leadEmail && (
                      <a href={`mailto:${selectedEvent.leadEmail}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent transition-colors">
                        <Mail className="h-3 w-3" />{selectedEvent.leadEmail}
                      </a>
                    )}
                  </div>
                  <a
                    href={`/leads/${selectedEvent.leadId}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                  >
                    <ExternalLink className="h-3 w-3" /> View Lead Details
                  </a>
                </div>
              )}

              {/* Linked Buyer */}
              {selectedEvent.buyerId && selectedEvent.buyerName && (
                <div className="border rounded-lg p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5" /> Linked Buyer
                  </p>
                  <p className="font-medium text-sm">{selectedEvent.buyerName}</p>
                  {selectedEvent.buyerCompany && (
                    <p className="text-xs text-muted-foreground">{selectedEvent.buyerCompany}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedEvent.buyerPhone && (
                      <a href={`tel:${selectedEvent.buyerPhone}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent transition-colors">
                        <Phone className="h-3 w-3" />{selectedEvent.buyerPhone}
                      </a>
                    )}
                    {selectedEvent.buyerEmail && (
                      <a href={`mailto:${selectedEvent.buyerEmail}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent transition-colors">
                        <Mail className="h-3 w-3" />{selectedEvent.buyerEmail}
                      </a>
                    )}
                  </div>
                  <a
                    href="/buyers"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                  >
                    <ExternalLink className="h-3 w-3" /> View Buyers
                  </a>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {selectedEvent.status === "scheduled" && (
                  <Button size="sm" variant="outline" onClick={() => handleQuickStatus("completed")}>
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark Complete
                  </Button>
                )}
                {selectedEvent.status === "scheduled" && (
                  <Button size="sm" variant="outline" onClick={() => handleQuickStatus("cancelled")}>
                    <XCircle className="h-4 w-4 mr-1.5" /> Cancel
                  </Button>
                )}
                {selectedEvent.status !== "scheduled" && (
                  <Button size="sm" variant="outline" onClick={() => handleQuickStatus("scheduled")}>
                    <Clock className="h-4 w-4 mr-1.5" /> Reschedule
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDetailOpen(false);
                    setEditDialogOpen(true);
                  }}
                >
                  <Edit3 className="h-4 w-4 mr-1.5" /> Edit
                </Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={handleDeleteEvent}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Edit dialog */}
      {selectedEvent && (
        <EventFormDialog
          onEventCreated={() => {
            handleRefresh();
            setSelectedEvent(null);
          }}
          editEvent={selectedEvent}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
        />
      )}
    </div>
  );
}
