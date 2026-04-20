"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Upload,
  Kanban,
  Map,
  ListOrdered,
  Search,
  Phone,
  UserCheck,
  Sparkles,
  ChevronRight,
  ArrowRight,
  MousePointerClick,
  GripVertical,
  Filter,
  Tags,
  FileSpreadsheet,
  Eye,
  PenLine,
  MessageSquare,
  Clock,
  Mail,
  PhoneCall,
  CheckSquare,
  DollarSign,
  MapPin,
  Crosshair,
  Download,
  UploadCloud,
  Play,
  ClipboardList,
  Zap,
  Target,
  Rocket,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const tourSections = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "leads", label: "Leads Table", icon: Users },
  { id: "csv-import", label: "CSV Import", icon: Upload },
  { id: "lead-detail", label: "Lead Detail", icon: Eye },
  { id: "pipeline", label: "Pipeline", icon: Kanban },
  { id: "map", label: "Map View", icon: Map },
  { id: "sequences", label: "Sequences", icon: ListOrdered },
  { id: "skip-trace", label: "Skip Trace", icon: Search },
  { id: "dialer", label: "Dialer", icon: Phone },
  { id: "buyers", label: "Buyers List", icon: UserCheck },
];

function StepItem({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
        {number}
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function WelcomeTourPage() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );

    for (const ref of Object.values(sectionRefs.current)) {
      if (ref) observer.observe(ref);
    }
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex gap-6">
      {/* Sticky sidebar table of contents */}
      <div className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-4 space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground px-3 mb-2">
            Tour Contents
          </h3>
          {tourSections.map((s) => {
            const isActive = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
          <Separator className="my-3" />
          <Link href="/">
            <Button size="sm" className="w-full gap-2">
              <Rocket className="h-3.5 w-3.5" />
              Start Using CRM
            </Button>
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 max-w-3xl space-y-8 pb-16">
        {/* Hero */}
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome to Deal Desk Pro
          </h1>
          <p className="text-muted-foreground mt-2 text-lg max-w-xl mx-auto">
            Your all-in-one CRM for real estate wholesaling. This tour walks you
            through every feature so you can close more deals, faster.
          </p>
          <div className="flex flex-wrap gap-2 justify-center mt-4">
            {tourSections.map((s) => (
              <Badge
                key={s.id}
                variant="outline"
                className="cursor-pointer"
                onClick={() => scrollTo(s.id)}
              >
                <s.icon className="h-3 w-3 mr-1" />
                {s.label}
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* 1. Dashboard */}
        <div
          id="dashboard"
          ref={(el) => { sectionRefs.current["dashboard"] = el; }}
        >
          <FeatureCard icon={LayoutDashboard} title="Dashboard" badge="Home">
            <p className="text-sm text-muted-foreground mb-4">
              The Dashboard is your command center. At a glance you see how your
              business is performing and jump to the most common actions.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Lead Counts by Status"
                description="Cards across the top show your total leads plus a count for every status: New, Contacted, Warm, Hot, Under Contract, Closed, Dead. Each card is color-coded."
              />
              <StepItem
                number={2}
                title="Quick Actions"
                description="Shortcuts to Import Leads, View All Leads, and open Map View. One click and you're there."
              />
              <StepItem
                number={3}
                title="Getting Started Checklist"
                description="A step-by-step list that reminds you of the optimal workflow: import, tag, sequence, map, skip-trace, and call."
              />
            </div>
            <div className="mt-4">
              <Link href="/">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Dashboard <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 2. Leads Table */}
        <div
          id="leads"
          ref={(el) => { sectionRefs.current["leads"] = el; }}
        >
          <FeatureCard icon={Users} title="Leads Table" badge="Core">
            <p className="text-sm text-muted-foreground mb-4">
              The Leads page is where you manage your entire lead database.
              Search, filter, sort, select, and take action in bulk.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Search Leads"
                description="Type in the search bar at the top to instantly filter leads by name, address, phone, or email. Results update as you type."
              />
              <StepItem
                number={2}
                title="Filter by Status"
                description="Use the status dropdown to show only New, Hot, Under Contract, etc. Combine with search for laser-focused results."
              />
              <StepItem
                number={3}
                title="Select Leads with Checkboxes"
                description="Click the checkbox on any row to select it. Use the header checkbox to select all visible leads at once."
              />
              <StepItem
                number={4}
                title="Bulk Actions"
                description="With leads selected, use the bulk action bar to change status, add tags, or delete multiple leads in one click."
              />
              <StepItem
                number={5}
                title="Click to View Detail"
                description="Click any lead row to open the full Lead Detail page where you can edit fields, add notes, and see the activity timeline."
              />
              <StepItem
                number={6}
                title="Create a New Lead"
                description="Click the 'Add Lead' button to manually create a single lead with name, address, phone, and other details."
              />
            </div>
            <div className="mt-4 flex gap-2">
              <Link href="/leads">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Leads <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 3. CSV Import */}
        <div
          id="csv-import"
          ref={(el) => { sectionRefs.current["csv-import"] = el; }}
        >
          <FeatureCard icon={Upload} title="CSV Import" badge="Import">
            <p className="text-sm text-muted-foreground mb-4">
              Bring in leads from any list source. The importer handles column
              mapping, previews, and duplicate detection automatically.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Drag and Drop Your File"
                description="Navigate to Import CSV from the sidebar. Drag your .csv file onto the upload zone, or click to browse your computer."
              />
              <StepItem
                number={2}
                title="Auto Column Mapping"
                description="Deal Desk Pro reads your CSV headers and automatically maps them to CRM fields (First Name, Last Name, Address, City, State, Zip, Phone, Email). Review and adjust any mis-mapped columns."
              />
              <StepItem
                number={3}
                title="Preview Before Import"
                description="See a preview table of the first rows so you can verify data looks correct before committing."
              />
              <StepItem
                number={4}
                title="Duplicate Detection"
                description="The importer checks for duplicate addresses already in your database and flags them so you can decide whether to skip or overwrite."
              />
              <StepItem
                number={5}
                title="Import and Confirm"
                description="Click Import to bring the leads into your database. A summary shows how many were imported, skipped, or flagged."
              />
            </div>
            <div className="mt-4">
              <Link href="/leads/import">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Import <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 4. Lead Detail */}
        <div
          id="lead-detail"
          ref={(el) => { sectionRefs.current["lead-detail"] = el; }}
        >
          <FeatureCard icon={Eye} title="Lead Detail" badge="Detail">
            <p className="text-sm text-muted-foreground mb-4">
              Every lead has a dedicated detail page where you can see and edit
              everything about that contact and property.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Inline Editing"
                description="Click on any field (name, phone, email, address) to edit it directly. Changes save automatically."
              />
              <StepItem
                number={2}
                title="Tags"
                description="Add tags to categorize leads (e.g., 'Absentee Owner', 'Pre-Foreclosure', 'Driving for Dollars'). Remove tags with the X button."
              />
              <StepItem
                number={3}
                title="Notes"
                description="Add timestamped notes to track conversations, property details, or follow-up reminders. Notes appear in reverse chronological order."
              />
              <StepItem
                number={4}
                title="Activity Timeline"
                description="See a complete history of every action taken on this lead: status changes, calls, notes, sequence enrollments, and edits."
              />
              <StepItem
                number={5}
                title="Change Status"
                description="Update the lead status from the dropdown at the top. Changing status here also moves the card in the Pipeline view."
              />
            </div>
          </FeatureCard>
        </div>

        {/* 5. Pipeline */}
        <div
          id="pipeline"
          ref={(el) => { sectionRefs.current["pipeline"] = el; }}
        >
          <FeatureCard icon={Kanban} title="Pipeline" badge="Visual">
            <p className="text-sm text-muted-foreground mb-4">
              The Pipeline is a Kanban-style board that gives you a visual
              overview of every deal moving through your workflow.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Visual Columns"
                description="Each column represents a status: New, Contacted, Warm, Hot, Under Contract, Closed, Dead. Leads appear as cards in their respective columns."
              />
              <StepItem
                number={2}
                title="Drag to Change Status"
                description="Grab any lead card and drag it to a different column to instantly update its status. No extra clicks needed."
              />
              <StepItem
                number={3}
                title="Card Preview"
                description="Each card shows the lead's name, address, and tags so you can identify deals at a glance."
              />
              <StepItem
                number={4}
                title="Click for Detail"
                description="Click any card to open the full lead detail page for deeper editing and notes."
              />
            </div>
            <div className="mt-4">
              <Link href="/pipeline">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Pipeline <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 6. Map View */}
        <div
          id="map"
          ref={(el) => { sectionRefs.current["map"] = el; }}
        >
          <FeatureCard icon={Map} title="Map View" badge="Geo">
            <p className="text-sm text-muted-foreground mb-4">
              See all your leads plotted on an interactive map. Geocoded
              addresses appear as colored markers you can click for details.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Colored Markers by Status"
                description="Each lead appears as a pin on the map, color-coded by its current status. Quickly see geographic clusters of hot leads vs. new ones."
              />
              <StepItem
                number={2}
                title="Filter by Status"
                description="Use the status filter to show only specific lead types on the map, like just 'Hot' leads in a particular neighborhood."
              />
              <StepItem
                number={3}
                title="Click for Lead Details"
                description="Click any marker to see a popup with the lead's name, address, status, and a link to the full detail page."
              />
              <StepItem
                number={4}
                title="Zoom and Pan"
                description="Use mouse scroll or pinch to zoom. Drag to pan. The map automatically centers on your leads' locations."
              />
            </div>
            <div className="mt-4">
              <Link href="/map">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Map <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 7. Sequences */}
        <div
          id="sequences"
          ref={(el) => { sectionRefs.current["sequences"] = el; }}
        >
          <FeatureCard icon={ListOrdered} title="Sequences" badge="Automation">
            <p className="text-sm text-muted-foreground mb-4">
              Automate your follow-up process. Create multi-step sequences with
              calls, emails, SMS, and tasks spaced out over days or weeks.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Create a Sequence"
                description="Click 'New Sequence', give it a name (e.g., 'New Lead 7-Day Follow-Up'), and start adding steps."
              />
              <StepItem
                number={2}
                title="Add Steps"
                description="Each step has a type (Call, Email, SMS, or Task), a delay in days from the previous step, and optional notes about what to say or do."
              />
              <StepItem
                number={3}
                title="Set Delays Between Steps"
                description="Configure how many days to wait between each step. For example: Day 1 call, Day 3 SMS, Day 7 email."
              />
              <StepItem
                number={4}
                title="Enroll Leads"
                description="From the Leads table or Lead Detail, enroll one or more leads into a sequence. The system tracks which step each lead is on."
              />
              <StepItem
                number={5}
                title="Track Progress"
                description="View the sequence detail page to see how many leads are enrolled, which step they're on, and completion rates."
              />
            </div>
            <div className="mt-4">
              <Link href="/sequences">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Sequences <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 8. Skip Trace */}
        <div
          id="skip-trace"
          ref={(el) => { sectionRefs.current["skip-trace"] = el; }}
        >
          <FeatureCard icon={Search} title="Skip Trace" badge="Data">
            <p className="text-sm text-muted-foreground mb-4">
              Find phone numbers, emails, and additional owner information for
              your leads by exporting them to skip tracing services.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Select Leads to Trace"
                description="On the Skip Trace page, choose which leads to export. Filter by status or tags to target the right subset."
              />
              <StepItem
                number={2}
                title="Choose a Provider"
                description="Select your preferred skip trace service: BatchSkipTracing, SkipEngine, or REISkip. Each provider expects a slightly different CSV format."
              />
              <StepItem
                number={3}
                title="Export CSV"
                description="Click Export to download a CSV formatted for your chosen provider. Upload this file to their platform to run the trace."
              />
              <StepItem
                number={4}
                title="Import Results"
                description="Once the provider returns results, import the enriched CSV back into Deal Desk Pro. Phone numbers and emails are matched to existing leads automatically."
              />
            </div>
            <div className="mt-4">
              <Link href="/skip-trace">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Skip Trace <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 9. Dialer */}
        <div
          id="dialer"
          ref={(el) => { sectionRefs.current["dialer"] = el; }}
        >
          <FeatureCard icon={Phone} title="Dialer" badge="Calls">
            <p className="text-sm text-muted-foreground mb-4">
              Make calls directly from the CRM. Use click-to-call for one-off
              calls or power dialer mode to blast through a list.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Click-to-Call"
                description="Every phone number in the CRM is a clickable tel: link. Click it to initiate a call through your phone app."
              />
              <StepItem
                number={2}
                title="Power Dialer Mode"
                description="Load a filtered set of leads into the power dialer. It presents one lead at a time with their details, and queues the next call automatically."
              />
              <StepItem
                number={3}
                title="Call Logging"
                description="After each call, log the outcome: Interested, Not Interested, No Answer, Left Voicemail, Wrong Number, or Do Not Call."
              />
              <StepItem
                number={4}
                title="Dispositions"
                description="Each disposition automatically updates the lead's status and records the call in the activity timeline with timestamp and notes."
              />
              <StepItem
                number={5}
                title="Call Notes"
                description="Add notes during or after the call. These are saved to the lead's activity timeline for future reference."
              />
            </div>
            <div className="mt-4">
              <Link href="/dialer">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Dialer <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* 10. Buyers List */}
        <div
          id="buyers"
          ref={(el) => { sectionRefs.current["buyers"] = el; }}
        >
          <FeatureCard icon={UserCheck} title="Buyers List" badge="Disposition">
            <p className="text-sm text-muted-foreground mb-4">
              Manage your cash buyer contacts. Track what areas they buy in,
              their price ranges, and property preferences.
            </p>
            <div className="space-y-3">
              <StepItem
                number={1}
                title="Add a Buyer"
                description="Click 'Add Buyer' and enter their name, company, phone, email, and buying criteria."
              />
              <StepItem
                number={2}
                title="Set Buy Criteria"
                description="Define the areas (cities, zip codes) the buyer is interested in, their price range (min/max), and preferred property types."
              />
              <StepItem
                number={3}
                title="Search and Filter"
                description="When you have a deal under contract, search your buyers list by area or price range to find matching buyers quickly."
              />
              <StepItem
                number={4}
                title="Contact Buyers"
                description="Click the buyer's phone or email to reach out directly. Track communication in notes."
              />
            </div>
            <div className="mt-4">
              <Link href="/buyers">
                <Button variant="outline" size="sm" className="gap-1">
                  Go to Buyers <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </FeatureCard>
        </div>

        {/* CTA */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="text-center py-8">
            <Rocket className="h-10 w-10 text-primary mx-auto mb-3" />
            <h2 className="text-2xl font-bold mb-2">
              You're Ready to Close Deals
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              You've seen every tool in Deal Desk Pro. Start importing leads,
              setting up sequences, and making calls today.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Link href="/">
                <Button size="lg" className="gap-2">
                  <Rocket className="h-4 w-4" />
                  Start Using Deal Desk Pro
                </Button>
              </Link>
              <Link href="/knowledge-base">
                <Button variant="outline" size="lg" className="gap-2">
                  Browse Knowledge Base
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
