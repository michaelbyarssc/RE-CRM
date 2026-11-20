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
        e.allDay === 1 ? "calendar-all-day" : "",
      ].filter(Boolean),
      extendedProps: {
        eventType: e.eventType,
        status: e.status,
        location: e.location,
      },
    };
  });

  return (
    <div className="calendar-wrapper @container bg-card border rounded-lg p-2 sm:p-4">
      <style>{`
        .calendar-wrapper .fc {
          --fc-border-color: var(--border);
          --fc-button-bg-color: var(--primary);
          --fc-button-border-color: var(--primary);
          --fc-button-hover-bg-color: oklch(0.70 0.14 85);
          --fc-button-hover-border-color: oklch(0.70 0.14 85);
          --fc-button-active-bg-color: oklch(0.65 0.13 85);
          --fc-button-active-border-color: oklch(0.65 0.13 85);
          --fc-today-bg-color: oklch(0.78 0.155 85 / 0.08);
          --fc-event-border-color: transparent;
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: var(--muted);
          --fc-list-event-hover-bg-color: var(--accent);
          --fc-button-text-color: var(--primary-foreground);
          font-family: inherit;
          color: var(--foreground);
        }
        .calendar-wrapper .fc .fc-toolbar-title {
          font-size: 1.15rem;
          font-weight: 600;
          color: oklch(0.78 0.155 85);
        }
        .calendar-wrapper .fc .fc-button {
          font-size: 0.8rem;
          padding: 0.35em 0.65em;
          border-radius: 6px;
          font-weight: 500;
          color: var(--primary-foreground);
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
          color: var(--foreground);
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
          background: oklch(0.78 0.155 85 / 0.08);
        }
        .calendar-wrapper .fc td, .calendar-wrapper .fc th {
          border-color: var(--border);
        }
        .calendar-wrapper .fc .fc-scrollgrid {
          border-color: var(--border);
        }
        .calendar-wrapper .fc .fc-list-day-cushion {
          background: var(--muted);
        }
        .calendar-wrapper .fc .fc-timegrid-slot-label {
          font-size: 0.7rem;
          color: var(--muted-foreground);
        }
        /* Month view, wide calendar: the time is never squeezed and a long
           title wraps under itself instead of being cut. */
        @container (min-width: 640px) {
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-daygrid-event {
            white-space: normal;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-event-main-frame {
            align-items: flex-start;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-event-time {
            flex-shrink: 0;
            max-width: none;
            overflow: visible;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-event-title {
            overflow: visible;
            overflow-wrap: anywhere;
          }
        }
        /* Month view, narrow calendar (tablet with the side menu, phone): a day is
           too narrow for words, so each event is a colored chip with its time only.
           The title is still in the tooltip, on tap, and in the List view. An
           all-day event has no time, so it shows as a thin colored marker. */
        @container (max-width: 639.98px) {
          .calendar-wrapper .fc .fc-toolbar {
            flex-direction: column;
            gap: 8px;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-daygrid-event {
            padding: 1px 2px;
            margin-left: 1px;
            margin-right: 1px;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-event-main-frame {
            justify-content: center;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-event-title-container {
            display: none;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-event-time {
            max-width: none;
            margin: 0;
            overflow: visible;
            white-space: normal;
            overflow-wrap: anywhere;
            text-align: center;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .calendar-all-day {
            height: 8px;
            padding: 0;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .calendar-all-day .fc-event-main {
            display: none;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .fc-daygrid-more-link {
            float: none;
            display: block;
            text-align: center;
          }
          .calendar-wrapper .fc .fc-dayGridMonth-view .calendar-more-word {
            display: none;
          }
        }
        @media (max-width: 640px) {
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
        eventDidMount={(info) => {
          // Tooltip with the time and the full title (the narrow month view hides the title).
          info.el.title = [info.timeText, info.event.title].filter(Boolean).join(" ");
        }}
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
        // "+2 more"; the word is hidden in the narrow month view, where only "+2" fits.
        moreLinkContent={(arg) => (
          <>
            +{arg.num}
            <span className="calendar-more-word"> more</span>
          </>
        )}
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
