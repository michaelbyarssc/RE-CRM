import { getLeadCounts } from "@/lib/actions/leads";
import { getUpcomingEvents } from "@/lib/actions/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEAD_STATUSES, EVENT_TYPE_MAP } from "@/lib/constants";
import Link from "next/link";
import { CalendarDays, Clock, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

function formatEventDate(iso: string, allDay: number | null) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const day = isToday ? "Today" : isTomorrow ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (allDay) return day;
  return `${day} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export default async function DashboardPage() {
  const counts = await getLeadCounts();
  let upcomingEvents: Awaited<ReturnType<typeof getUpcomingEvents>> = [];
  try {
    upcomingEvents = await getUpcomingEvents(5);
  } catch {
    // Table may not exist yet
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{counts.total}</div>
          </CardContent>
        </Card>

        {LEAD_STATUSES.map((status) => {
          const count =
            counts.byStatus.find((s) => s.status === status.value)?.count ?? 0;
          return (
            <Card key={status.value}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${status.color}`} />
                  {status.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{count}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Upcoming Events */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Upcoming Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingEvents.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                <p>No upcoming events</p>
                <Link href="/calendar" className="text-primary hover:underline text-xs mt-1 block">
                  Open Calendar
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map((event) => {
                  const typeInfo = EVENT_TYPE_MAP[event.eventType as keyof typeof EVENT_TYPE_MAP];
                  const linkedName = event.leadId
                    ? [event.leadFirstName, event.leadLastName].filter(Boolean).join(" ") || event.leadAddress
                    : event.buyerName;
                  return (
                    <Link
                      key={event.id}
                      href="/calendar"
                      className="block p-2.5 rounded-md border hover:bg-accent transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: typeInfo?.hex || "#6B7280" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{event.title}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" />
                            {formatEventDate(event.startAt, event.allDay)}
                          </p>
                          {linkedName && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {event.leadId ? "Lead" : "Buyer"}: {linkedName}
                            </p>
                          )}
                          {event.location && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3" />{event.location}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
                <Link href="/calendar" className="block text-xs text-primary hover:underline text-center pt-1">
                  View Full Calendar
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              href="/leads/import"
              className="block p-3 rounded-md border hover:bg-accent transition-colors"
            >
              <div className="font-medium">Import Leads</div>
              <div className="text-sm text-muted-foreground">
                Upload a CSV file to import new leads
              </div>
            </Link>
            <Link
              href="/leads"
              className="block p-3 rounded-md border hover:bg-accent transition-colors"
            >
              <div className="font-medium">View All Leads</div>
              <div className="text-sm text-muted-foreground">
                Browse and manage your lead database
              </div>
            </Link>
            <Link
              href="/map"
              className="block p-3 rounded-md border hover:bg-accent transition-colors"
            >
              <div className="font-medium">Map View</div>
              <div className="text-sm text-muted-foreground">
                View leads on an interactive map
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>1. Import your leads via CSV upload</p>
            <p>2. Tag and categorize your leads</p>
            <p>3. Set up follow-up sequences</p>
            <p>4. Use the map to visualize lead locations</p>
            <p>5. Skip trace leads to find contact info</p>
            <p>6. Start making calls with the dialer</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
