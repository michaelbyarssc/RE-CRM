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

// Where the phone number goes in the leads table. The owner is choosing between
// these; the two unused branches are removed once the choice is made.
//   "under-name":       second line under the name, no Phone column (recommended)
//   "column-when-wide": own Phone column when the list is 1115 px or wider,
//                       under the name below that
//   "column":           own Phone column always (the old shape; scrolls
//                       sideways on a 1280 laptop)
type PhonePlacement = "under-name" | "column-when-wide" | "column";
const PHONE_PLACEMENT = "under-name" as PhonePlacement;

// Class names for each table column, by column id. The list region is a
// container named "leads", so these follow the width the list really has
// (the side menu always takes 256 px), not the screen width. Name and street
// get a fixed width and wrap inside it, so long data cannot push other
// columns out of view.
const NAME_WIDTH =
  PHONE_PLACEMENT === "under-name"
    ? "w-[180px] @min-[1100px]/leads:w-[236px]"
    : "w-[180px] @min-[1115px]/leads:w-[190px]";
const ADDRESS_WIDTH =
  PHONE_PLACEMENT === "under-name"
    ? "w-[212px] @min-[1100px]/leads:w-[244px]"
    : "w-[212px] @min-[1115px]/leads:w-[226px]";
// The inline phone line shows when there is no Phone column, and the
// Phone column cells show when there is one.
const INLINE_PHONE_CLASS =
  PHONE_PLACEMENT === "column-when-wide" ? "@min-[1115px]/leads:hidden" : "";
const COLUMN_CLASS: Record<string, string> = {
  phone:
    PHONE_PLACEMENT === "column-when-wide"
      ? "hidden @min-[1115px]/leads:table-cell"
      : "",
};

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

function PhoneLink({ phone, className = "" }: { phone: string; className?: string }) {
  return (
    <a
      href={`tel:${phone}`}
      className={`flex w-fit min-w-0 items-start gap-1 text-sm [overflow-wrap:anywhere] hover:underline ${className}`}
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
              <DropdownMenuTrigger>
                <button
                  aria-label="Add tag"
                  className="inline-flex items-center justify-center w-5 h-5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </button>
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
  const pageSize = 50;

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    const res = await fetch(`/api/leads?${params}`);
    const data = await res.json();
    setLeads(data.leads);
    setTotal(data.total);
    setLoading(false);
  }, [search, statusFilter, page]);

  const fetchTags = useCallback(async () => {
    const res = await fetch("/api/tags");
    const data = await res.json();
    setAllTags(data);
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

  const selectedIds = Object.keys(rowSelection)
    .filter((key) => rowSelection[key])
    .map((key) => leads[Number(key)]?.id)
    .filter(Boolean);

  const handleBulkAction = async (
    action: string,
    extra?: Record<string, unknown>
  ) => {
    if (selectedIds.length === 0) return;
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: selectedIds, ...extra }),
    });
    setRowSelection({});
    fetchLeads();
  };

  const handleStatusChange = async (id: number, status: string) => {
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchLeads();
  };

  const handleAddTag = async (leadId: number, tagId: number) => {
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addTag", tagId }),
    });
    toast.success("Tag added");
    fetchLeads();
  };

  const handleRemoveTag = async (leadId: number, tagId: number) => {
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeTag", tagId }),
    });
    toast.success("Tag removed");
    fetchLeads();
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
            {PHONE_PLACEMENT !== "column" && (
              <div data-slot="lead-phone-inline" className={INLINE_PHONE_CLASS}>
                {lead.phone ? (
                  <PhoneLink phone={lead.phone} />
                ) : (
                  <span className="text-sm text-muted-foreground">No phone</span>
                )}
              </div>
            )}
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
    ...(PHONE_PLACEMENT === "under-name"
      ? []
      : [
          {
            accessorKey: "phone",
            header: "Phone",
            cell: ({ row }) => {
              const phone = row.original.phone;
              return phone ? (
                <PhoneLink phone={phone} />
              ) : (
                <span className="text-muted-foreground text-sm">-</span>
              );
            },
          } satisfies ColumnDef<Lead>,
        ]),
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
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  });

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Leads ({total})</h1>
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
              <DropdownMenuTrigger>
                <Button variant="outline" size="sm">
                  Bulk Actions
                </Button>
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
                          }).then(() =>
                            toast.success(`Updated ${selectedIds.length} leads`)
                          )
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
                          }).then(() =>
                            toast.success(`Tagged ${selectedIds.length} leads`)
                          )
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
                      handleBulkAction("delete").then(() =>
                        toast.success(`Deleted ${selectedIds.length} leads`)
                      );
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

      {/* The list region is one container, so its shape follows the width the
          list really has: one column of cards under 700 px, two columns up to
          939 px, the table from 940 px. */}
      <div className="@container/leads">
        {/* Card View */}
        <div
          data-leads-view="cards"
          className="grid grid-cols-1 gap-3 @min-[700px]/leads:grid-cols-2 @min-[940px]/leads:hidden"
        >
          {loading ? (
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
            leads.map((lead, idx) => {
              const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
              const isSelected = rowSelection[idx] === true;
              return (
                <div
                  key={lead.id}
                  className={`min-w-0 border rounded-lg p-3 space-y-2 ${isSelected ? "bg-primary/5 border-primary" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(value) => {
                          setRowSelection((prev) => ({ ...prev, [idx]: !!value }));
                        }}
                      />
                      <button
                        onClick={() => router.push(`/leads/${lead.id}`)}
                        className="font-medium hover:underline text-left truncate"
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
                    <TableHead key={header.id} className={COLUMN_CLASS[header.column.id]}>
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
              {loading ? (
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
                      <TableCell
                        key={cell.id}
                        data-col={cell.column.id === "phone" ? "phone" : undefined}
                        className={COLUMN_CLASS[cell.column.id]}
                      >
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
