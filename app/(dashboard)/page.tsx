import { getLeadCounts } from "@/lib/actions/leads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEAD_STATUSES } from "@/lib/constants";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const counts = await getLeadCounts();

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
