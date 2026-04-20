"use client";

import { useState, useMemo } from "react";
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
  BookOpen,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/* Knowledge Base data                                                 */
/* ------------------------------------------------------------------ */

interface Article {
  question: string;
  answer: string;
}

interface Category {
  id: string;
  label: string;
  icon: React.ElementType;
  articles: Article[];
}

const categories: Category[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    icon: Sparkles,
    articles: [
      {
        question: "What is Deal Desk Pro and who is it for?",
        answer:
          "Deal Desk Pro is a full-featured CRM built specifically for real estate wholesalers. It helps you manage leads, run follow-up sequences, skip trace property owners, make calls with a built-in dialer, and track your cash buyers — all from a single dashboard. If you buy and assign contracts on distressed or off-market properties, this tool was designed for your workflow.",
      },
      {
        question: "How do I get started after signing up?",
        answer:
          "After signing up and logging in you will land on the Dashboard. The recommended first steps are:\n\n1. Import your leads — Go to the sidebar and click 'Import CSV'. Drag and drop your first list (e.g., a tax-delinquent list from your county or a driving-for-dollars list). Map the columns and import.\n\n2. Review and tag your leads — Go to 'Leads' in the sidebar. Browse the table, click into individual leads, and add tags like 'Absentee' or 'Pre-Foreclosure' to organize them.\n\n3. Set up a sequence — Go to 'Sequences' and create a follow-up sequence such as a 7-day new-lead outreach with call, SMS, and email steps.\n\n4. Skip trace for contact info — Go to 'Skip Trace', select leads that need phone numbers, choose a provider, and export. After the provider returns results, import them back.\n\n5. Start calling — Go to 'Dialer', load your leads, and begin making calls using click-to-call or power dialer mode.\n\n6. Add buyers — As you build relationships with cash buyers, add them to 'Buyers' with their buy criteria so you can quickly match deals.",
      },
      {
        question: "What does each section of the sidebar do?",
        answer:
          "The sidebar contains every major feature:\n\n- Dashboard — Overview of lead counts by status, quick action links, and a getting-started checklist.\n- Leads — Searchable and filterable table of all your leads. Create, edit, bulk-action, and delete leads here.\n- Import CSV — Upload CSV files to import leads in bulk. Supports column mapping and duplicate detection.\n- Pipeline — Kanban board view showing leads organized by status as draggable cards.\n- Map — Interactive map with color-coded pins for every geocoded lead.\n- Sequences — Create automated multi-step follow-up sequences with calls, emails, SMS, and tasks.\n- Skip Trace — Export leads for skip tracing with supported providers and import the results back.\n- Dialer — Click-to-call and power dialer with call logging and dispositions.\n- Buyers — Manage your cash buyer contacts with buy criteria (areas, price ranges).\n- Welcome Tour — An interactive guide to every feature (you can revisit it anytime).\n- Knowledge Base — The page you are reading now, with searchable how-to articles.",
      },
      {
        question: "How do I navigate back to the Dashboard?",
        answer:
          "Click 'Dashboard' in the sidebar, or click the 'Deal Desk Pro' logo text at the top of the sidebar. Both take you to the main Dashboard page showing your lead counts and quick actions.",
      },
    ],
  },
  {
    id: "leads",
    label: "Leads Management",
    icon: Users,
    articles: [
      {
        question: "How do I view all my leads?",
        answer:
          "Click 'Leads' in the sidebar. The Leads page displays a table with all your leads. Each row shows the lead's name, address, city, state, phone, status, and tags. The table is paginated — use the controls at the bottom to move between pages.",
      },
      {
        question: "How do I search for a specific lead?",
        answer:
          "On the Leads page there is a search bar at the top. Type any part of the lead's name, address, phone number, or email. The table filters in real-time as you type. To clear the search, erase the text or click the X button in the search field.",
      },
      {
        question: "How do I filter leads by status?",
        answer:
          "On the Leads page, look for the status filter dropdown next to the search bar. Click it and select one or more statuses (e.g., 'Hot', 'Under Contract'). The table will update to show only leads matching those statuses. Select 'All' to reset the filter.",
      },
      {
        question: "How do I change a lead's status?",
        answer:
          "There are two ways:\n\n1. From the Leads table — Click on a lead row to open the Lead Detail page. At the top you will see a status dropdown. Click it and select the new status. The change saves immediately.\n\n2. From the Pipeline — Go to 'Pipeline' in the sidebar. Find the lead card and drag it from one status column to another. The status updates automatically when you drop the card.",
      },
      {
        question: "How do I select multiple leads and perform bulk actions?",
        answer:
          "On the Leads table:\n\n1. Click the checkbox on the left side of each lead row you want to select. To select all visible leads at once, click the checkbox in the table header row.\n\n2. A bulk action bar appears at the top of the table showing how many leads are selected.\n\n3. From the bulk action bar you can:\n   - Change Status — Pick a new status and apply to all selected leads at once.\n   - Add Tags — Type a tag name and apply it to all selected leads.\n   - Delete — Remove all selected leads (you will be asked to confirm).\n\n4. After performing the action, the selection clears automatically.",
      },
      {
        question: "How do I create a new lead manually?",
        answer:
          "On the Leads page, click the 'Add Lead' button in the top-right area. A form appears where you can enter:\n\n- First Name and Last Name\n- Property Address, City, State, Zip Code\n- Phone Number and Email\n- Initial Status (defaults to 'New')\n\nFill in the fields and click Save. The lead is added to your database and appears in the Leads table immediately.",
      },
      {
        question: "How do I delete a lead?",
        answer:
          "Open the lead's detail page by clicking on it in the Leads table. Look for the Delete button (usually at the bottom or in a menu). Click it and confirm the deletion. Alternatively, use bulk select on the Leads table: check the lead's row, then click Delete in the bulk action bar.",
      },
      {
        question: "How do I add or remove tags on a lead?",
        answer:
          "Open the Lead Detail page by clicking the lead in the Leads table. In the tags section:\n\n- To add a tag: Type the tag name in the tag input field and press Enter. The tag appears as a badge on the lead.\n- To remove a tag: Click the X button on the tag badge. It is removed immediately.\n\nCommon tags for wholesaling: 'Absentee Owner', 'Pre-Foreclosure', 'Tax Delinquent', 'Vacant', 'Driving for Dollars', 'Probate', 'High Equity'.",
      },
    ],
  },
  {
    id: "csv-import",
    label: "CSV Import",
    icon: Upload,
    articles: [
      {
        question: "How do I import leads from a CSV file?",
        answer:
          "Step-by-step walkthrough:\n\n1. Click 'Import CSV' in the sidebar.\n2. You will see a drag-and-drop upload zone. Either drag your .csv file onto it, or click the zone to open a file browser and select the file.\n3. Deal Desk Pro reads the CSV headers and presents a column-mapping screen. Each CRM field (First Name, Last Name, Address, City, State, Zip, Phone, Email) has a dropdown showing which CSV column maps to it.\n4. The system auto-maps columns by name when possible. Review each mapping and adjust any that were guessed incorrectly.\n5. A preview table shows the first several rows of data with your mapping applied. Verify the data looks correct.\n6. Click 'Import' to bring the leads into your database.\n7. A summary shows how many leads were imported, how many duplicates were skipped, and any errors.",
      },
      {
        question: "What CSV format does Deal Desk Pro expect?",
        answer:
          "Deal Desk Pro accepts any standard CSV file with a header row. There is no required column order. The importer maps your columns to these CRM fields:\n\n- First Name\n- Last Name\n- Property Address\n- City\n- State\n- Zip Code\n- Phone\n- Email\n\nYour CSV can have additional columns — they will be listed in the mapping screen but you can skip columns you don't need. The file must use UTF-8 encoding and comma delimiters.",
      },
      {
        question: "How does duplicate detection work during import?",
        answer:
          "When you import a CSV, Deal Desk Pro checks each row against existing leads in your database by matching on the property address. If a lead with the same address already exists, it is flagged as a duplicate in the import preview. You can choose to skip duplicates (recommended) or overwrite them with the new data.",
      },
      {
        question: "What happens if my CSV has missing or malformed data?",
        answer:
          "The importer handles partial data gracefully:\n\n- Missing fields are left blank on the lead record — you can fill them in later.\n- Rows with no address are flagged with a warning in the preview.\n- Phone numbers are normalized automatically (parentheses, dashes, and spaces are stripped).\n- If the entire file cannot be parsed (e.g., wrong delimiter or encoding), an error message tells you what went wrong.",
      },
      {
        question: "Can I import from ListSource, PropStream, or other list providers?",
        answer:
          "Yes. Export a CSV from any list provider (ListSource, PropStream, BatchLeads, REISkip, county tax records, etc.) and import it using the CSV importer. Each provider uses slightly different column names, but the auto-mapping handles most variations. Just double-check the mapping screen before importing.",
      },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    icon: Kanban,
    articles: [
      {
        question: "What is the Pipeline view?",
        answer:
          "The Pipeline is a Kanban-style board that displays your leads as cards organized into columns by status. The columns from left to right are: New, Contacted, Warm, Hot, Under Contract, Closed, and Dead. Each card shows the lead's name, property address, and tags. This view gives you a visual overview of your entire deal flow.",
      },
      {
        question: "How do I move a lead between Pipeline stages?",
        answer:
          "Click and hold on any lead card in the Pipeline. Drag it to the desired status column and release. The lead's status is updated immediately. For example, after your first call with a motivated seller, drag the card from 'New' to 'Contacted'. When they show strong interest, drag to 'Hot'.",
      },
      {
        question: "Can I click a Pipeline card to see lead details?",
        answer:
          "Yes. Click on any card in the Pipeline to navigate to that lead's full detail page. There you can edit fields, add notes, manage tags, and see the complete activity timeline. Use the browser back button or the sidebar to return to the Pipeline.",
      },
      {
        question: "What do the status columns mean for wholesaling?",
        answer:
          "The status columns map to a typical wholesale deal lifecycle:\n\n- New — Freshly imported or created lead, not yet contacted.\n- Contacted — You have made initial contact (call, text, or mail).\n- Warm — The seller has shown some interest but is not ready yet.\n- Hot — The seller is motivated and you are working toward an offer.\n- Under Contract — You have a signed purchase agreement.\n- Closed — The deal assigned or closed successfully.\n- Dead — The lead is not viable (wrong number, not interested, property sold, etc.).",
      },
    ],
  },
  {
    id: "map",
    label: "Map",
    icon: Map,
    articles: [
      {
        question: "How do I view leads on the map?",
        answer:
          "Click 'Map' in the sidebar. The Map page loads an interactive Leaflet map with markers for every lead that has a geocoded address. The map auto-centers and zooms to fit all your markers. If you have no geocoded leads, the map shows a default view.",
      },
      {
        question: "What do the marker colors mean?",
        answer:
          "Each marker is color-coded by the lead's current status:\n\n- Blue — New\n- Yellow — Contacted\n- Orange — Warm\n- Red — Hot\n- Purple — Under Contract\n- Green — Closed\n- Gray — Dead\n\nThis lets you visually spot clusters of hot or new leads in specific neighborhoods.",
      },
      {
        question: "How do I filter markers on the map?",
        answer:
          "Use the status filter controls above the map. Click a status button to toggle that status on or off. Only markers for enabled statuses will appear. For example, turn off everything except 'Hot' to see only your most motivated sellers on the map.",
      },
      {
        question: "How do I see details for a lead from the map?",
        answer:
          "Click any marker on the map. A popup appears showing the lead's name, property address, and current status. The popup also contains a link to the lead's full detail page where you can edit information, add notes, and take action.",
      },
      {
        question: "Why aren't some leads showing on the map?",
        answer:
          "Leads only appear on the map if their address has been successfully geocoded (converted to latitude and longitude coordinates). If a lead has an incomplete, misspelled, or invalid address, geocoding may fail and the lead won't appear. Check the lead's detail page to verify the address is complete and correctly formatted.",
      },
    ],
  },
  {
    id: "sequences",
    label: "Sequences",
    icon: ListOrdered,
    articles: [
      {
        question: "What are sequences and why should I use them?",
        answer:
          "Sequences are automated follow-up plans that define a series of steps (calls, emails, SMS messages, or tasks) to be performed at specific intervals. They ensure no lead falls through the cracks by giving you a structured outreach schedule. In wholesaling, consistent follow-up is the number one driver of deals — sequences make that systematic.",
      },
      {
        question: "How do I create a new sequence?",
        answer:
          "Step by step:\n\n1. Click 'Sequences' in the sidebar.\n2. Click the 'New Sequence' button.\n3. Enter a name for the sequence (e.g., 'Cold Lead 14-Day Drip').\n4. Click 'Add Step' to create your first step.\n5. For each step, choose:\n   - Type: Call, Email, SMS, or Task\n   - Delay: Number of days after the previous step (0 for the first step means execute immediately on enrollment)\n   - Notes: Optional instructions for what to say or do\n6. Add as many steps as you need. A typical wholesaling sequence might be: Day 0 Call, Day 2 SMS, Day 5 Call, Day 7 Email, Day 14 Call.\n7. Click Save to create the sequence.",
      },
      {
        question: "How do I enroll leads into a sequence?",
        answer:
          "From the Leads table or the Lead Detail page, select the leads you want to enroll. Look for the 'Enroll in Sequence' option in the actions menu or bulk action bar. Choose the sequence from the dropdown and confirm. The system starts tracking each lead through the sequence steps according to the configured delays.",
      },
      {
        question: "How do I track which step a lead is on?",
        answer:
          "Open the sequence by clicking it on the Sequences page. The detail view shows all enrolled leads and their current step. Each lead's row displays the step number, step type, and whether it has been completed or is pending. You can also see a lead's sequence status from their individual Lead Detail page in the activity timeline.",
      },
      {
        question: "Can I edit or delete a sequence after creation?",
        answer:
          "Yes. Open the sequence detail page and click Edit. You can rename the sequence, add new steps, modify existing step types and delays, or remove steps. Changes apply to newly enrolled leads. Leads already in progress will continue on their current step unless you reset them.",
      },
      {
        question: "What is a good follow-up sequence for wholesaling?",
        answer:
          "A proven 30-day new lead sequence:\n\n- Day 0: Call — Introduce yourself and ask about the property.\n- Day 1: SMS — 'Hi [Name], I called yesterday about your property at [Address]. Are you interested in a cash offer?'\n- Day 3: Call — Second attempt if no answer on Day 0.\n- Day 5: Email — Formal introduction with your company info and a brief offer to help.\n- Day 7: Call — Third attempt. Leave voicemail if no answer.\n- Day 14: SMS — Check-in message.\n- Day 21: Call — Follow-up on any interest.\n- Day 30: Email — Final touch explaining you are still interested.\n\nAdjust timing and channels based on your market and response rates.",
      },
    ],
  },
  {
    id: "skip-trace",
    label: "Skip Tracing",
    icon: Search,
    articles: [
      {
        question: "What is skip tracing?",
        answer:
          "Skip tracing is the process of finding contact information (phone numbers, email addresses) for property owners. When you pull a list of distressed properties, you often only have the owner's name and property address. Skip tracing services match that information against databases to return phone numbers and emails so you can reach the owner.",
      },
      {
        question: "How do I export leads for skip tracing?",
        answer:
          "Step by step:\n\n1. Click 'Skip Trace' in the sidebar.\n2. The page shows your leads that need tracing (those without phone numbers, or all leads depending on your filter).\n3. Select the leads you want to trace using checkboxes.\n4. Choose your skip trace provider from the dropdown: BatchSkipTracing, SkipEngine, or REISkip.\n5. Click 'Export CSV'. A CSV file downloads to your computer, formatted with the columns your chosen provider expects.\n6. Log into your skip trace provider's website and upload the CSV file.\n7. Wait for the provider to process the file (usually minutes to hours).\n8. Download the results file from the provider.",
      },
      {
        question: "How do I import skip trace results back into Deal Desk Pro?",
        answer:
          "After downloading the results file from your skip trace provider:\n\n1. Return to the 'Skip Trace' page in Deal Desk Pro.\n2. Click the 'Import Results' button.\n3. Upload the results CSV file from your provider.\n4. The system matches results to existing leads by property address and owner name.\n5. Phone numbers and email addresses are populated on matching leads.\n6. A summary shows how many leads were updated, how many had no match, and any errors.",
      },
      {
        question: "Which skip trace providers are supported?",
        answer:
          "Deal Desk Pro supports export formatting for three popular providers:\n\n- BatchSkipTracing (batchskiptracing.com) — Affordable bulk tracing. CSV format includes First Name, Last Name, Address, City, State, Zip.\n- SkipEngine (skipengine.com) — Fast turnaround. Similar CSV format with slight column name variations.\n- REISkip (reiskip.com) — Real estate investor focused. Includes mailing address support.\n\nYou can use any other provider too — just export a generic CSV and manually upload to their platform.",
      },
      {
        question: "How often should I skip trace my leads?",
        answer:
          "Best practices:\n\n- Skip trace new leads immediately after import so you have contact info for your first outreach.\n- Re-trace leads every 3-6 months because phone numbers change. About 10-15% of phone numbers go stale each year.\n- Always trace before a big calling campaign to ensure you have current data.\n- Focus your skip trace budget on high-priority leads (high equity, absentee owners, tax delinquent) rather than tracing everything at once.",
      },
    ],
  },
  {
    id: "dialer",
    label: "Dialer",
    icon: Phone,
    articles: [
      {
        question: "How do I make a call from Deal Desk Pro?",
        answer:
          "There are two ways to call:\n\n1. Click-to-Call — On any page where a phone number appears (Leads table, Lead Detail, Dialer), click the phone number. It opens your default phone app via a tel: link. This works with desktop softphones, mobile phones, or VoIP apps.\n\n2. Power Dialer — Go to 'Dialer' in the sidebar. Load a set of leads (filtered by status, tag, or sequence). The dialer presents one lead at a time with their full details. Click 'Call' to initiate, and after the call, log the disposition and move to the next lead automatically.",
      },
      {
        question: "How do I use the power dialer mode?",
        answer:
          "Step by step:\n\n1. Click 'Dialer' in the sidebar.\n2. Configure your call list using the filters at the top. For example, filter to 'New' status leads that have phone numbers.\n3. Click 'Start Dialer' to begin.\n4. The screen shows the first lead's details: name, address, phone, tags, notes, and previous activity.\n5. Click the 'Call' button to initiate the call via tel: link.\n6. After the call, select a disposition from the dropdown (Interested, Not Interested, No Answer, Left Voicemail, Wrong Number, Do Not Call).\n7. Optionally add call notes in the text field.\n8. Click 'Next' to move to the next lead in the queue.\n9. Repeat until you have worked through the list or click 'Stop' to end the session.",
      },
      {
        question: "What are call dispositions and how do they work?",
        answer:
          "Dispositions are the outcome codes you assign after each call:\n\n- Interested — The seller showed interest. Lead status can be updated to Warm or Hot.\n- Not Interested — The seller is not motivated right now. Lead remains in current status or moves to Dead.\n- No Answer — No one picked up. Lead stays in current status for follow-up.\n- Left Voicemail — You left a message. Lead stays for callback follow-up.\n- Wrong Number — The phone number is invalid. Useful for data hygiene.\n- Do Not Call — The person requested no further calls. Lead is flagged DNC.\n\nEach disposition is logged in the lead's activity timeline with a timestamp, making it easy to review call history later.",
      },
      {
        question: "How do I add notes during or after a call?",
        answer:
          "While on the Dialer screen (or on the Lead Detail page), you will see a notes text area. Type your notes during the conversation — key details like the seller's asking price, property condition, motivation level, or timeline. After selecting a disposition and clicking Next (in power dialer) or Save (on the detail page), the notes are saved to the lead's activity timeline.",
      },
      {
        question: "Can I see my call history for a lead?",
        answer:
          "Yes. Open the Lead Detail page and scroll to the activity timeline. Every call you log appears as an entry with the date, time, disposition, and any notes you added. This gives you a complete chronological record of all interactions before your next call.",
      },
    ],
  },
  {
    id: "buyers",
    label: "Buyers",
    icon: UserCheck,
    articles: [
      {
        question: "How do I add a new cash buyer?",
        answer:
          "Step by step:\n\n1. Click 'Buyers' in the sidebar.\n2. Click the 'Add Buyer' button.\n3. Fill in the buyer's information: Name, Company (optional), Phone, and Email.\n4. Define their buy criteria:\n   - Areas: Cities, zip codes, or counties they are active in.\n   - Price Range: Minimum and maximum purchase price.\n   - Property Types: Single family, multi-family, commercial, land, etc.\n5. Click Save. The buyer is added to your buyers list.",
      },
      {
        question: "How do I find a buyer for my deal?",
        answer:
          "When you have a property under contract:\n\n1. Go to 'Buyers' in the sidebar.\n2. Use the search bar to filter by area (city or zip code) matching your property location.\n3. Review the list of buyers whose criteria match your deal's location and price point.\n4. Click a buyer's phone or email to reach out with the deal details.\n5. Track your communication in the buyer's notes section.",
      },
      {
        question: "How do I edit a buyer's information or criteria?",
        answer:
          "On the Buyers page, click on the buyer you want to edit. Their detail view opens with all fields editable: name, company, phone, email, areas, price range, and property type preferences. Make your changes and click Save.",
      },
      {
        question: "What buy criteria should I track for each buyer?",
        answer:
          "Essential criteria for matching deals to buyers:\n\n- Target Areas — Specific cities, zip codes, or neighborhoods. Most cash buyers have tight geographic focus.\n- Price Range — Maximum purchase price and minimum (some buyers won't bother with deals under a certain threshold).\n- Property Types — SFR (single family residential), multifamily, land, commercial. Most wholesale buyers want SFR.\n- Condition Preference — Some buyers want turnkey, others want heavy rehab. Track this in notes.\n- Speed — How fast they can close. Some buyers close in 7 days, others need 30.\n- Proof of Funds — Whether they have provided POF. Note this for quick reference.",
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

function ArticleItem({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-3 text-left text-sm font-medium hover:bg-accent/50 transition-colors rounded-lg"
      >
        <span>{article.question}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
          {article.answer}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function KnowledgeBasePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return categories;

    return categories
      .map((cat) => ({
        ...cat,
        articles: cat.articles.filter(
          (a) =>
            a.question.toLowerCase().includes(q) ||
            a.answer.toLowerCase().includes(q)
        ),
      }))
      .filter((cat) => cat.articles.length > 0);
  }, [searchQuery]);

  const totalArticles = categories.reduce(
    (sum, cat) => sum + cat.articles.length,
    0
  );

  const visibleCategories = activeCategory
    ? filteredCategories.filter((c) => c.id === activeCategory)
    : filteredCategories;

  return (
    <div className="flex gap-6">
      {/* Sidebar navigation */}
      <div className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-4 space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground px-3 mb-2">
            Categories
          </h3>
          <button
            onClick={() => setActiveCategory(null)}
            className={`flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors ${
              activeCategory === null
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            All Articles
            <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">
              {totalArticles}
            </Badge>
          </button>
          {categories.map((cat) => {
            const matchCount = filteredCategories.find(
              (c) => c.id === cat.id
            )?.articles.length;
            return (
              <button
                key={cat.id}
                onClick={() =>
                  setActiveCategory(activeCategory === cat.id ? null : cat.id)
                }
                className={`flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors ${
                  activeCategory === cat.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <cat.icon className="h-3.5 w-3.5" />
                {cat.label}
                {matchCount !== undefined && searchQuery && (
                  <Badge
                    variant="secondary"
                    className="ml-auto text-[10px] px-1.5"
                  >
                    {matchCount}
                  </Badge>
                )}
              </button>
            );
          })}
          <Separator className="my-3" />
          <Link href="/welcome">
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Welcome Tour
            </Button>
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 max-w-3xl space-y-6 pb-16">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Knowledge Base
          </h1>
          <p className="text-muted-foreground mt-1">
            Search {totalArticles} articles covering every feature of Deal Desk
            Pro.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search articles... (e.g., 'import CSV', 'skip trace', 'power dialer')"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Mobile category chips */}
        <div className="flex flex-wrap gap-2 lg:hidden">
          <Badge
            variant={activeCategory === null ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setActiveCategory(null)}
          >
            All
          </Badge>
          {categories.map((cat) => (
            <Badge
              key={cat.id}
              variant={activeCategory === cat.id ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() =>
                setActiveCategory(activeCategory === cat.id ? null : cat.id)
              }
            >
              {cat.label}
            </Badge>
          ))}
        </div>

        {/* Articles */}
        {visibleCategories.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-medium text-lg">No articles found</h3>
              <p className="text-muted-foreground mt-1">
                Try a different search term or clear the filter.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory(null);
                }}
              >
                Clear Filters
              </Button>
            </CardContent>
          </Card>
        ) : (
          visibleCategories.map((cat) => (
            <div key={cat.id}>
              <div className="flex items-center gap-2 mb-3">
                <cat.icon className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">{cat.label}</h2>
                <Badge variant="secondary" className="text-xs">
                  {cat.articles.length}{" "}
                  {cat.articles.length === 1 ? "article" : "articles"}
                </Badge>
              </div>
              <div className="space-y-2">
                {cat.articles.map((article, i) => (
                  <ArticleItem key={i} article={article} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
