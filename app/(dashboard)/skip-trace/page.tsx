"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";
import { Download, Upload, Search, FileSpreadsheet } from "lucide-react";

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
}

const PROVIDERS = [
  { value: "batch_skip_tracing", label: "BatchSkipTracing" },
  { value: "skip_engine", label: "SkipEngine" },
  { value: "rei_skip", label: "REISkip" },
  { value: "other", label: "Other" },
];

export default function SkipTracePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [provider, setProvider] = useState("batch_skip_tracing");
  const [importProvider, setImportProvider] = useState("batch_skip_tracing");
  // True after a refused load, until a load succeeds. With no leads on the
  // screen it shows a sentence instead of an empty list that looks real.
  const [loadFailed, setLoadFailed] = useState(false);
  // True while a results file is being saved. The ref blocks a second file at once.
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);

  // Loads the leads. On a refusal the leads already on the screen stay.
  // `quiet` is for the reload after an import with refused rows: its message is already shown.
  const fetchLeads = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const res = await apiFetch("/api/leads?pageSize=200");
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
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  };

  const handleExport = () => {
    const selectedLeads = leads.filter((l) => selected.has(l.id));
    if (selectedLeads.length === 0) {
      toast.error("Select leads to export");
      return;
    }

    let csvData: Record<string, string>[];

    if (provider === "batch_skip_tracing") {
      csvData = selectedLeads.map((l) => ({
        "First Name": l.firstName || "",
        "Last Name": l.lastName || "",
        "Address": l.propertyAddress,
        "City": l.propertyCity || "",
        "State": l.propertyState || "",
        "Zip": l.propertyZip || "",
      }));
    } else if (provider === "skip_engine") {
      csvData = selectedLeads.map((l) => ({
        "Owner First Name": l.firstName || "",
        "Owner Last Name": l.lastName || "",
        "Property Street Address": l.propertyAddress,
        "Property City": l.propertyCity || "",
        "Property State": l.propertyState || "",
        "Property Zip Code": l.propertyZip || "",
      }));
    } else if (provider === "rei_skip") {
      csvData = selectedLeads.map((l) => ({
        "First Name": l.firstName || "",
        "Last Name": l.lastName || "",
        "Street Address": l.propertyAddress,
        "City": l.propertyCity || "",
        "State": l.propertyState || "",
        "Zip": l.propertyZip || "",
      }));
    } else {
      csvData = selectedLeads.map((l) => ({
        "First Name": l.firstName || "",
        "Last Name": l.lastName || "",
        "Address": l.propertyAddress,
        "City": l.propertyCity || "",
        "State": l.propertyState || "",
        "Zip": l.propertyZip || "",
      }));
    }

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `skip-trace-${provider}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedLeads.length} leads for ${PROVIDERS.find((p) => p.value === provider)?.label}`);
  };

  const handleImportResults = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Empty the picker so the same file can be chosen again for a retry.
    // The file itself stays readable.
    e.target.value = "";
    if (!file || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    const finish = () => {
      importingRef.current = false;
      setImporting(false);
    };

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      error: () => {
        finish();
        toast.error("Could not read the file. Check that it is a CSV file and try again.");
      },
      complete: async (results) => {
        try {
          const data = results.data as Record<string, string>[];
          let updated = 0;
          let refused = 0;
          // The first refused answer, used to say why rows could not be saved.
          let firstRefusal: Response | null = null;

          for (const row of data) {
            // Try to match by address
            const address =
              row["Address"] ||
              row["Property Street Address"] ||
              row["Street Address"] ||
              row["Property Address"] ||
              "";

            if (!address) continue;

            const phone =
              row["Phone 1"] ||
              row["Phone"] ||
              row["Best Phone"] ||
              row["Mobile Phone"] ||
              row["Cell Phone"] ||
              "";
            const email =
              row["Email 1"] ||
              row["Email"] ||
              row["Best Email"] ||
              "";

            if (!phone && !email) continue;

            // Find matching lead
            const matchingLead = leads.find(
              (l) =>
                l.propertyAddress.toLowerCase().trim() ===
                address.toLowerCase().trim()
            );

            if (matchingLead) {
              const updateData: Record<string, string> = {};
              if (phone && !matchingLead.phone) updateData.phone = phone;
              if (email && !matchingLead.email) updateData.email = email;

              if (Object.keys(updateData).length > 0) {
                const res = await apiFetch(`/api/leads/${matchingLead.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(updateData),
                });
                if (!res.ok) {
                  refused++;
                  firstRefusal ??= res;
                  continue;
                }
                updated++;
              }
            }
          }

          if (firstRefusal) {
            // Quiet reload: the message about the refused rows is the one the user reads.
            fetchLeads({ quiet: true });
            toast.error(
              await apiErrorMessage(
                firstRefusal,
                `Saved ${updated} of ${updated + refused} leads. ${refused} could not be saved`,
                "Check that each phone number has at most 50 characters and each email at most 320."
              )
            );
            return;
          }
          fetchLeads();
          toast.success(`Updated ${updated} leads with skip trace results`);
        } finally {
          finish();
        }
      },
    });
  };

  const noPhoneLeads = leads.filter((l) => !l.phone);
  const showLoadFailed = loadFailed && leads.length === 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Skip Trace</h1>

      <Tabs defaultValue="export">
        <TabsList>
          <TabsTrigger value="export">Export for Skip Trace</TabsTrigger>
          <TabsTrigger value="import">Import Results</TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="mt-4">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Select Leads to Export</span>
                <div className="flex flex-wrap items-center gap-3">
                  {!showLoadFailed && (
                    <Badge variant="outline">
                      {noPhoneLeads.length} leads without phone
                    </Badge>
                  )}
                  <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleExport}
                    disabled={selected.size === 0}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export {selected.size} Leads
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showLoadFailed && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Your leads could not be loaded. Refresh the page to try again.
                </p>
              )}
              {/* Mobile card view */}
              <div className={showLoadFailed ? "hidden" : "md:hidden space-y-2"}>
                <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                  <Checkbox
                    checked={selected.size === leads.length && leads.length > 0}
                    onCheckedChange={selectAll}
                  />
                  <span className="text-sm text-muted-foreground">Select All</span>
                </div>
                {leads.map((lead) => (
                  <div
                    key={lead.id}
                    className={`border rounded-md p-3 ${selected.has(lead.id) ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected.has(lead.id)}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "-"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{lead.propertyAddress}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                          <span className="text-xs">
                            {lead.phone || <span className="text-muted-foreground">No phone</span>}
                          </span>
                          <span className="text-xs">
                            {lead.email || <span className="text-muted-foreground">No email</span>}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className={showLoadFailed ? "hidden" : "hidden md:block border rounded-md"}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selected.size === leads.length && leads.length > 0}
                          onCheckedChange={selectAll}
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                          />
                        </TableCell>
                        <TableCell className="text-sm">
                          {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "-"}
                        </TableCell>
                        <TableCell className="text-sm">{lead.propertyAddress}</TableCell>
                        <TableCell className="text-sm">
                          {lead.phone || (
                            <span className="text-muted-foreground">Missing</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {lead.email || (
                            <span className="text-muted-foreground">Missing</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Import Skip Trace Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Upload the results CSV from your skip trace provider. We will match
                    leads by property address and update their phone/email.
                  </p>
                  <Select value={importProvider} onValueChange={(v) => v && setImportProvider(v)}>
                    <SelectTrigger className="w-[200px] mb-3">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm mb-3">Upload skip trace results CSV</p>
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    id="skip-trace-import"
                    onChange={handleImportResults}
                    disabled={importing}
                  />
                  <label
                    htmlFor="skip-trace-import"
                    aria-disabled={importing}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      importing ? "pointer-events-none opacity-50" : "cursor-pointer"
                    )}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {importing ? "Saving results..." : "Select File"}
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
