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
      cell: ({ row }) => (
        <div className="flex gap-1 flex-wrap">
          {row.original.tags.map((tag) => (
            <TagBadge key={tag.id} name={tag.name} color={tag.color} />
          ))}
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Added",
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Leads ({total})</h1>
        <div className="flex items-center gap-2">
          <AddLeadDialog onLeadCreated={fetchLeads} />
          <Button variant="outline" onClick={() => router.push("/leads/import")}>Import CSV</Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
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
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
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

      {/* Table */}
      <div className="border rounded-md">
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
