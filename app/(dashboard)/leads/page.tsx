"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  RowSelectionState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { LeadStatusSelect } from "@/components/leads/lead-status-badge";
import { AddLeadDialog } from "@/components/leads/add-lead-dialog";
import { QuickNoteDialog } from "@/components/leads/quick-note-dialog";
import { TagBadge } from "@/components/tags/tag-badge";
import { LEAD_STATUSES } from "@/lib/constants";
import { toast } from "sonner";
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";
import {
  Search,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Tag,
  Phone,
  Plus,
} from "lucide-react";

// Name and street get a fixed width in the leads table and wrap inside it,
// so long data cannot push other columns out of view. The list region is a
// container named "leads", so the wider widths follow the width the list
// really has (the side menu always takes 256 px), not the screen width.
const NAME_WIDTH = "w-[176px] @min-[1100px]/leads:w-[236px]";
const ADDRESS_WIDTH = "w-[212px] @min-[1100px]/leads:w-[244px]";

const ADDED_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const ADDED_FULL = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

function AddedDate({ value }: { value: string }) {
  const date = new Date(value);
  // The column is plain text, so a row written outside the app may not hold
  // a readable date; formatting one would throw and take down the page.
  if (Number.isNaN(date.getTime())) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  const otherYear = date.getFullYear() !== new Date().getFullYear();
  return (
    <div className="text-xs text-muted-foreground" title={ADDED_FULL.format(date)}>
      <div>{ADDED_DAY.format(date)}</div>
      {otherYear && <div>{date.getFullYear()}</div>}
    </div>
  );
}

function PhoneLink({ phone }: { phone: string }) {
  return (
    <a
      href={`tel:${phone}`}
      className="flex w-fit min-w-0 items-start gap-1 text-sm [overflow-wrap:anywhere] hover:underline"
    >
      {/* Top-aligned and nudged to the middle of the first line, so the icon
          stays beside the first line when a long value wraps. */}
      <Phone className="mt-1.5 h-3 w-3 shrink-0" />
      <span className="min-w-0">{phone}</span>
    </a>
  );
}

interface LeadTag {
  id: number;
  name: string;
  color: string;
}

interface Lead {
  id: number;
  firstName: string | null;
  lastName: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  tags: LeadTag[];
  createdAt: string;
}

// The tag chips, the add-tag "+" and its menu, shared by the table and the
// cards. The caller supplies the wrapping row around them.
function LeadTagChips({
  tags,
  allTags,
  menuAlign,
  tailGap,
  onRemove,
  onAdd,
}: {
  tags: LeadTag[];
  allTags: LeadTag[];
  menuAlign: "start" | "end";
  tailGap: string;
  onRemove: (tagId: number) => void;
  onAdd: (tagId: number) => void;
}) {
  const tagIds = tags.map((t) => t.id);
  const available = allTags.filter((t) => !tagIds.includes(t.id));
  const chip = (tag: LeadTag) => (
    <TagBadge
      key={tag.id}
      name={tag.name}
      color={tag.color}
      onRemove={() => onRemove(tag.id)}
    />
  );
  return (
    <>
      {tags.slice(0, -1).map(chip)}
      {/* The last chip and the "+" travel together, so the "+" never sits
          alone on a line. The pair can still wrap inside itself, so a long
          last tag cannot force the row wider than its box. */}
      {(tags.length > 0 || available.length > 0) && (
        <div data-slot="lead-tags-tail" className={`flex flex-wrap items-center ${tailGap}`}>
          {tags.slice(-1).map(chip)}
          {available.length > 0 && (
            <DropdownMenu>
              {/* The trigger is the real button, so the "+" inside it is a span:
                  a button inside a button breaks the page's HTML. */}
              <DropdownMenuTrigger aria-label="Add tag">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                  <Plus className="h-3 w-3" />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={menuAlign}>
                {available.map((tag) => (
                  <DropdownMenuItem key={tag.id} onClick={() => onAdd(tag.id)}>
                    <span
                      className="w-2 h-2 rounded-full mr-2"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </>
  );
}

// What the bulk actions menu tells the user, per action.
const BULK_TEXTS: Record<"updateStatus" | "addTag" | "delete", { what: string; check?: string; done: (n: number) => string }> = {
  updateStatus: {
    what: "Could not change the status of the selected leads",
    check: "Pick one of the statuses in the list.",
    done: (n) => `Updated ${n} leads`,
  },
  addTag: { what: "Could not tag the selected leads", done: (n) => `Tagged ${n} leads` },
  delete: { what: "Could not delete the selected leads", done: (n) => `Deleted ${n} leads` },
};

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [allTags, setAllTags] = useState<LeadTag[]>([]);
  const [loading, setLoading] = useState(true);
  // True after a refused load, until a load succeeds. With no leads on the
  // screen it shows a sentence instead of "No leads found", which would not be true.
  const [loadFailed, setLoadFailed] = useState(false);
  const pageSize = 50;

  // Loads one page of leads. On a refusal the leads already on the screen stay.
  // `quiet` is for the reload after a refused change: its message is already shown.
  const fetchLeads = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (statusFilter !== "all") params.set("status", statusFilter);
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));

        const res = await apiFetch(`/api/leads?${params}`);
        if (!res.ok) {
          setLoadFailed(true);
          if (!quiet) toast.error(await apiErrorMessage(res, "Could not load your leads"));
          return;
        }
        const data = await res.json().catch(() => null);
        if (!data || !Array.isArray(data.leads)) {
          setLoadFailed(true);
          if (!quiet) toast.error("Could not load your leads. Something went wrong on our side. Try again in a minute.");
          return;
        }
        setLoadFailed(false);
        setLeads(data.leads);
        // The selection is kept by lead id. Drop the ids of leads that are no
        // longer on the screen, so a bulk action never reaches a lead the user cannot see.
        const shownIds = new Set((data.leads as Lead[]).map((l) => String(l.id)));
        setRowSelection((prev) => {
          const kept = Object.fromEntries(
            Object.entries(prev).filter(([key, on]) => on && shownIds.has(key))
          );
          return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
        });
        // The server sends a number (since 2026-11-20). Numeric text is still read as a number, as a safety net.
        // Anything else (missing, null, not a number) falls back to the leads on this page.
        const count = typeof data.total === "string" && data.total.trim() !== "" ? Number(data.total) : data.total;
        setTotal(typeof count === "number" && Number.isFinite(count) ? count : data.leads.length);
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, page]
  );

  // Quiet on a refusal: the leads load next to it already tells the user. The tags on the screen stay.
  const fetchTags = useCallback(async () => {
    const res = await apiFetch("/api/tags");
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) setAllTags(data);
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Debounce search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // The selected leads that are on the screen, by id (the table's row id is the lead id).
  const selectedIds = leads
    .filter((lead) => rowSelection[String(lead.id)])
    .map((lead) => lead.id);

  const handleBulkAction = async (
    action: "updateStatus" | "addTag" | "delete",
    extra?: Record<string, unknown>
  ) => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const texts = BULK_TEXTS[action];
    const res = await apiFetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: selectedIds, ...extra }),
    });
    // On a refusal the selection stays so the user can try again.
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, texts.what, texts.check));
      fetchLeads({ quiet: true });
      return;
    }
    setRowSelection({});
    fetchLeads();
    toast.success(texts.done(count));
  };

  const handleStatusChange = async (id: number, status: string) => {
    const res = await apiFetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    // Reload either way so each row shows the status that was saved.
    // After a refusal the reload is quiet, so the message about the status is the one the user reads.
    if (!res.ok) {
      toast.error(
        await apiErrorMessage(res, "Could not update the status", "Pick one of the statuses in the list.")
      );
      fetchLeads({ quiet: true });
      return;
    }
    fetchLeads();
  };

  const handleAddTag = async (leadId: number, tagId: number) => {
    const res = await apiFetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addTag", tagId }),
    });
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not add the tag"));
      fetchLeads({ quiet: true });
      return;
    }
    fetchLeads();
    toast.success("Tag added");
  };

  const handleRemoveTag = async (leadId: number, tagId: number) => {
    const res = await apiFetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeTag", tagId }),
    });
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not remove the tag"));
      fetchLeads({ quiet: true });
      return;
    }
    fetchLeads();
    toast.success("Tag removed");
  };

  const columns: ColumnDef<Lead>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const lead = row.original;
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
        return (
          <div className={`${NAME_WIDTH} whitespace-normal [overflow-wrap:anywhere]`}>
            <button
              onClick={() => router.push(`/leads/${lead.id}`)}
              className="font-medium hover:underline text-left"
            >
              {name || "Unknown"}
            </button>
            <div data-slot="lead-phone-inline">
              {lead.phone ? (
                <PhoneLink phone={lead.phone} />
              ) : (
                <span className="text-sm text-muted-foreground">No phone</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "propertyAddress",
      header: "Property Address",
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className={`${ADDRESS_WIDTH} whitespace-normal [overflow-wrap:anywhere]`}>
            <div className="text-sm">{lead.propertyAddress}</div>
            <div className="text-xs text-muted-foreground">
              {[lead.propertyCity, lead.propertyState, lead.propertyZip]
                .filter(Boolean)
                .join(", ")}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <LeadStatusSelect
          status={row.original.status}
          onStatusChange={(s) => handleStatusChange(row.original.id, s)}
        />
      ),
    },
    {
      accessorKey: "tags",
      header: "Tags",
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex gap-1 flex-wrap items-center">
            <LeadTagChips
              tags={lead.tags}
              allTags={allTags}
              menuAlign="start"
              tailGap="gap-1"
              onRemove={(tagId) => handleRemoveTag(lead.id, tagId)}
              onAdd={(tagId) => handleAddTag(lead.id, tagId)}
            />
          </div>
        );
      },
    },
    {
      id: "notes",
      // Kept for screen readers; the column is only as wide as its button.
      header: () => <span className="sr-only">Notes</span>,
      cell: ({ row }) => {
        const lead = row.original;
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
        return <QuickNoteDialog leadId={lead.id} leadName={name} />;
      },
    },
    {
      accessorKey: "createdAt",
      header: "Added",
      cell: ({ row }) => <AddedDate value={row.original.createdAt} />,
    },
  ];

  const table = useReactTable({
    data: leads,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Keep the selection by lead id, not by row position: after a reload the
    // rows can come back in another order.
    getRowId: (row) => String(row.id),
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  });

  const totalPages = Math.ceil(total / pageSize);
  const showLoadFailed = loadFailed && leads.length === 0;
  // Runs the same load again (not quiet, so a second refusal says so again).
  // After a refused load the filter may already show the new value, so picking it again would send nothing.
  const retryButton = (
    <Button variant="outline" size="sm" onClick={() => fetchLeads()} disabled={loading}>
      Try again
    </Button>
  );

  return (
    <div>
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">{showLoadFailed ? "Leads" : `Leads (${total})`}</h1>
        <div className="flex items-center gap-2">
          <AddLeadDialog onLeadCreated={fetchLeads} />
          <Button variant="outline" onClick={() => router.push("/leads/import")}>Import CSV</Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v) setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[184px]">
            {(() => {
              if (statusFilter === "all") return <span>All Statuses</span>;
              const s = LEAD_STATUSES.find((s) => s.value === statusFilter);
              return (
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${s?.color}`} />
                  {s?.label ?? statusFilter}
                </span>
              );
            })()}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {selectedIds.length} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                Bulk Actions
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    Change Status
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {LEAD_STATUSES.map((s) => (
                      <DropdownMenuItem
                        key={s.value}
                        onClick={() =>
                          handleBulkAction("updateStatus", {
                            status: s.value,
                          })
                        }
                      >
                        <span className={`w-2 h-2 rounded-full ${s.color} mr-2`} />
                        {s.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Tag className="h-4 w-4 mr-2" />
                    Add Tag
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {allTags.map((tag) => (
                      <DropdownMenuItem
                        key={tag.id}
                        onClick={() =>
                          handleBulkAction("addTag", {
                            tagId: tag.id,
                          })
                        }
                      >
                        <span
                          className="w-2 h-2 rounded-full mr-2"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    if (confirm(`Delete ${selectedIds.length} leads?`)) {
                      handleBulkAction("delete");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* The leads on the screen are from an earlier load. */}
      {loadFailed && leads.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-sm text-muted-foreground">
          <span>This list could not be updated. It may not match the search and filter above.</span>
          {retryButton}
        </div>
      )}

      {/* The list region is one container, so its shape follows the width the
          list really has: one column of cards under 700 px, two columns up to
          939 px, the table from 940 px. */}
      <div className="@container/leads">
        {/* Card View */}
        <div
          data-leads-view="cards"
          className="grid grid-cols-1 gap-3 @min-[700px]/leads:grid-cols-2 @min-[940px]/leads:hidden"
        >
          {showLoadFailed ? (
            <div className="col-span-full flex flex-wrap items-center justify-center gap-3 py-8 text-muted-foreground">
              <span>Your leads could not be loaded.</span>
              {retryButton}
            </div>
          ) : loading ? (
            <div className="col-span-full text-center py-8 text-muted-foreground">Loading...</div>
          ) : leads.length === 0 ? (
            <div className="col-span-full text-center py-8 text-muted-foreground">
              <p>No leads found</p>
              <p className="text-sm mt-1">
                Add a lead manually or{" "}
                <Button variant="link" className="p-0 h-auto" onClick={() => router.push("/leads/import")}>
                  import a CSV
                </Button>
              </p>
            </div>
          ) : (
            leads.map((lead) => {
              const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
              const isSelected = rowSelection[String(lead.id)] === true;
              return (
                <div
                  key={lead.id}
                  className={`min-w-0 border rounded-lg p-3 space-y-2 ${isSelected ? "bg-primary/5 border-primary" : ""}`}
                >
                  {/* A long name wraps onto more lines, so this row is aligned at
                      the top: the checkbox and the note button stay level with
                      the first line of the name. The note button is 28 px high
                      and a line of the name is 24 px, so the name gets 2 px
                      above and below, and the checkbox is centered in a 28 px
                      high box. A one-line row looks the same as before. */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="flex h-7 shrink-0 items-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(value) => {
                            setRowSelection((prev) => ({ ...prev, [String(lead.id)]: !!value }));
                          }}
                        />
                      </span>
                      <button
                        onClick={() => router.push(`/leads/${lead.id}`)}
                        className="font-medium hover:underline text-left min-w-0 py-0.5 [overflow-wrap:anywhere]"
                      >
                        {name}
                      </button>
                    </div>
                    <div className="shrink-0">
                      <QuickNoteDialog leadId={lead.id} leadName={name} />
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground pl-6 [overflow-wrap:anywhere]">
                    <div>{lead.propertyAddress}</div>
                    <div className="text-xs">
                      {[lead.propertyCity, lead.propertyState, lead.propertyZip]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  </div>
                  <div className="pl-6">
                    {lead.phone ? (
                      <PhoneLink phone={lead.phone} />
                    ) : (
                      <span className="text-sm text-muted-foreground">No phone</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-2 pl-6">
                    <div className="mr-1">
                      <LeadStatusSelect
                        status={lead.status}
                        onStatusChange={(s) => handleStatusChange(lead.id, s)}
                      />
                    </div>
                    <LeadTagChips
                      tags={lead.tags}
                      allTags={allTags}
                      menuAlign="end"
                      tailGap="gap-x-1 gap-y-2"
                      onRemove={(tagId) => handleRemoveTag(lead.id, tagId)}
                      onAdd={(tagId) => handleAddTag(lead.id, tagId)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Table View */}
        <div data-leads-view="table" className="hidden @min-[940px]/leads:block border rounded-md">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {showLoadFailed ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-8 text-muted-foreground">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <span>Your leads could not be loaded.</span>
                      {retryButton}
                    </div>
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center py-8">
                    <div className="text-muted-foreground">
                      <p>No leads found</p>
                      <p className="text-sm mt-1">
                        Add a lead manually or{" "}
                        <Button
                          variant="link"
                          className="p-0 h-auto"
                          onClick={() => router.push("/leads/import")}
                        >
                          import a CSV
                        </Button>
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}-
            {Math.min(page * pageSize, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
