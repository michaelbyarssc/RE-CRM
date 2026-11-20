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
import { LeadStatusBadge, LeadStatusSelect } from "@/components/leads/lead-status-badge";
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
          if (!quiet) toast.error(await apiErrorMessage(res, "Could not load your leads"));
          return;
        }
        const data = await res.json().catch(() => null);
        if (!data || !Array.isArray(data.leads)) {
          if (!quiet) toast.error("Could not load your leads. Something went wrong on our side. Try again in a minute.");
          return;
        }
        setLeads(data.leads);
        setTotal(typeof data.total === "number" ? data.total : data.leads.length);
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

  const selectedIds = Object.keys(rowSelection)
    .filter((key) => rowSelection[key])
    .map((key) => leads[Number(key)]?.id)
    .filter(Boolean);

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
      size: 40,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const lead = row.original;
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
        return (
          <button
            onClick={() => router.push(`/leads/${lead.id}`)}
            className="font-medium hover:underline text-left"
          >
            {name || "Unknown"}
          </button>
        );
      },
    },
    {
      accessorKey: "propertyAddress",
      header: "Property Address",
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div>
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
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => {
        const phone = row.original.phone;
        return phone ? (
          <a href={`tel:${phone}`} className="flex items-center gap-1 text-sm hover:underline">
            <Phone className="h-3 w-3" />
            {phone}
          </a>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
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
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => {
        const lead = row.original;
        const leadTagIds = lead.tags.map((t) => t.id);
        const availableTags = allTags.filter((t) => !leadTagIds.includes(t.id));
        return (
          <div className="flex gap-1 flex-wrap items-center">
            {lead.tags.map((tag) => (
              <TagBadge
                key={tag.id}
                name={tag.name}
                color={tag.color}
                onRemove={() => handleRemoveTag(lead.id, tag.id)}
              />
            ))}
            {availableTags.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button className="inline-flex items-center justify-center w-5 h-5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors" />
                  }
                >
                  <Plus className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {availableTags.map((tag) => (
                    <DropdownMenuItem
                      key={tag.id}
                      onClick={() => handleAddTag(lead.id, tag.id)}
                    >
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
        );
      },
    },
    {
      id: "notes",
      header: "Notes",
      cell: ({ row }) => {
        const lead = row.original;
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
        return <QuickNoteDialog leadId={lead.id} leadName={name} />;
      },
      size: 60,
    },
    {
      accessorKey: "createdAt",
      header: "Added",
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </span>
      ),
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
          <SelectTrigger className="w-full sm:w-[160px]">
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

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : leads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
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
                className={`border rounded-lg p-3 space-y-2 ${isSelected ? "bg-primary/5 border-primary" : ""}`}
              >
                <div className="flex items-start justify-between">
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
                  <div className="flex items-center gap-1 shrink-0">
                    <QuickNoteDialog leadId={lead.id} leadName={name} />
                    <LeadStatusSelect
                      status={lead.status}
                      onStatusChange={(s) => handleStatusChange(lead.id, s)}
                    />
                  </div>
                </div>
                <div className="text-sm text-muted-foreground pl-6">
                  <div>{lead.propertyAddress}</div>
                  <div className="text-xs">
                    {[lead.propertyCity, lead.propertyState, lead.propertyZip]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                </div>
                <div className="flex items-center justify-between pl-6">
                  <div>
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="flex items-center gap-1 text-sm hover:underline">
                        <Phone className="h-3 w-3" />
                        {lead.phone}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">No phone</span>
                    )}
                  </div>
                  <div className="flex gap-1 flex-wrap items-center">
                    {lead.tags.map((tag) => (
                      <TagBadge
                        key={tag.id}
                        name={tag.name}
                        color={tag.color}
                        onRemove={() => handleRemoveTag(lead.id, tag.id)}
                      />
                    ))}
                    {(() => {
                      const leadTagIds = lead.tags.map((t) => t.id);
                      const available = allTags.filter((t) => !leadTagIds.includes(t.id));
                      if (available.length === 0) return null;
                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button className="inline-flex items-center justify-center w-5 h-5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors" />
                            }
                          >
                            <Plus className="h-3 w-3" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {available.map((tag) => (
                              <DropdownMenuItem
                                key={tag.id}
                                onClick={() => handleAddTag(lead.id, tag.id)}
                              >
                                <span
                                  className="w-2 h-2 rounded-full mr-2"
                                  style={{ backgroundColor: tag.color }}
                                />
                                {tag.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block border rounded-md">
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
