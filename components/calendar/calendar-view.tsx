"use client";

import { useRef, useEffect, MutableRefObject } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { EVENT_TYPE_MAP } from "@/lib/constants";

interface CalendarEvent {
  id: number;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string | null;
  allDay: number | null;
  status: string;
  location: string | null;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  buyerName?: string | null;
}

interface CalendarViewProps {
  events: CalendarEvent[];
  onEventClick: (eventId: number) => void;
  onDateClick: (dateStr: string) => void;
  onFetchEvents: (start: string, end: string) => Promise<CalendarEvent[]>;
  refreshRef: MutableRefObject<(() => void) | null>;
}

export function CalendarView({
  events,
  onEventClick,
  onDateClick,
  onFetchEvents,
  refreshRef,
}: CalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const currentRangeRef = useRef<{ start: string; end: string } | null>(null);

  // Expose refresh function
  useEffect(() => {
    refreshRef.current = () => {
      if (currentRangeRef.current) {
        onFetchEvents(currentRangeRef.current.start, currentRangeRef.current.end);
      }
    };
  }, [refreshRef, onFetchEvents]);

  const fcEvents = events.map((e) => {
    const typeInfo = EVENT_TYPE_MAP[e.eventType as keyof typeof EVENT_TYPE_MAP];
    const isCompleted = e.status === "completed";
    const isCancelled = e.status === "cancelled";

    return {
      id: String(e.id),
      title: e.title,
      start: e.startAt,
      end: e.endAt || undefined,
      allDay: e.allDay === 1,
      backgroundColor: isCancelled ? "#9CA3AF" : isCompleted ? "#6B7280" : (typeInfo?.hex || "#6B7280"),
      borderColor: isCancelled ? "#9CA3AF" : isCompleted ? "#6B7280" : (typeInfo?.hex || "#6B7280"),
      textColor: "white",
      classNames: [
        isCancelled ? "opacity-50 line-through" : "",
        isCompleted ? "opacity-70" : "",
      ].filter(Boolean),
      extendedProps: {
        eventType: e.eventType,
        status: e.status,
        location: e.location,
      },
    };
  });

  return (
    <div className="calendar-wrapper bg-card border rounded-lg p-2 sm:p-4">
      <style>{`
        .calendar-wrapper .fc {
          --fc-border-color: hsl(var(--border));
          --fc-button-bg-color: hsl(var(--primary));
          --fc-button-border-color: hsl(var(--primary));
          --fc-button-hover-bg-color: hsl(var(--primary) / 0.9);
          --fc-button-hover-border-color: hsl(var(--primary) / 0.9);
          --fc-button-active-bg-color: hsl(var(--primary) / 0.8);
          --fc-button-active-border-color: hsl(var(--primary) / 0.8);
          --fc-today-bg-color: hsl(var(--primary) / 0.05);
          --fc-event-border-color: transparent;
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: hsl(var(--muted));
          --fc-list-event-hover-bg-color: hsl(var(--accent));
          font-family: inherit;
        }
        .calendar-wrapper .fc .fc-toolbar-title {
          font-size: 1.15rem;
          font-weight: 600;
        }
        .calendar-wrapper .fc .fc-button {
          font-size: 0.8rem;
          padding: 0.35em 0.65em;
          border-radius: 6px;
          font-weight: 500;
        }
        .calendar-wrapper .fc .fc-button-group .fc-button {
          border-radius: 0;
        }
        .calendar-wrapper .fc .fc-button-group .fc-button:first-child {
          border-radius: 6px 0 0 6px;
        }
        .calendar-wrapper .fc .fc-button-group .fc-button:last-child {
          border-radius: 0 6px 6px 0;
        }
        .calendar-wrapper .fc .fc-daygrid-day-number,
        .calendar-wrapper .fc .fc-col-header-cell-cushion {
          font-size: 0.8rem;
          color: hsl(var(--foreground));
        }
        .calendar-wrapper .fc .fc-event {
          border-radius: 4px;
          font-size: 0.75rem;
          padding: 1px 4px;
          cursor: pointer;
        }
        .calendar-wrapper .fc .fc-event .fc-event-title {
          font-weight: 500;
        }
        .calendar-wrapper .fc .fc-daygrid-day.fc-day-today {
          background: hsl(var(--primary) / 0.05);
        }
        .calendar-wrapper .fc td, .calendar-wrapper .fc th {
          border-color: hsl(var(--border));
        }
        .calendar-wrapper .fc .fc-scrollgrid {
          border-color: hsl(var(--border));
        }
        .calendar-wrapper .fc .fc-list-day-cushion {
          background: hsl(var(--muted));
        }
        .calendar-wrapper .fc .fc-timegrid-slot-label {
          font-size: 0.7rem;
        }
        @media (max-width: 640px) {
          .calendar-wrapper .fc .fc-toolbar {
            flex-direction: column;
            gap: 8px;
          }
          .calendar-wrapper .fc .fc-toolbar-title {
            font-size: 1rem;
          }
          .calendar-wrapper .fc .fc-button {
            font-size: 0.7rem;
            padding: 0.25em 0.5em;
          }
        }
      `}</style>
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
        }}
        events={fcEvents}
        eventClick={(info) => {
          info.jsEvent.preventDefault();
          onEventClick(Number(info.event.id));
        }}
        dateClick={(info) => {
          onDateClick(info.dateStr);
        }}
        datesSet={(dateInfo) => {
          const start = dateInfo.startStr;
          const end = dateInfo.endStr;
          currentRangeRef.current = { start, end };
          onFetchEvents(start, end);
        }}
        height="auto"
        contentHeight="auto"
        dayMaxEvents={3}
        nowIndicator
        selectable
        editable={false}
        eventDisplay="block"
        buttonText={{
          today: "Today",
          month: "Month",
          week: "Week",
          day: "Day",
          list: "List",
        }}
      />
    </div>
  );
}
