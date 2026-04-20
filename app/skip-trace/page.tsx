"use client";

import { useState, useEffect, useCallback } from "react";
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

  const fetchLeads = useCallback(async () => {
    const res = await fetch("/api/leads?pageSize=200");
    const data = await res.json();
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
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data as Record<string, string>[];
        let updated = 0;

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
              await fetch(`/api/leads/${matchingLead.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updateData),
              });
              updated++;
            }
          }
        }

        toast.success(`Updated ${updated} leads with skip trace results`);
        fetchLeads();
      },
    });
  };

  const noPhoneLeads = leads.filter((l) => !l.phone);

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
              <CardTitle className="flex items-center justify-between">
                <span>Select Leads to Export</span>
                <div className="flex items-center gap-3">
                  <Badge variant="outline">
                    {noPhoneLeads.length} leads without phone
                  </Badge>
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
              <div className="border rounded-md">
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
                  />
                  <label htmlFor="skip-trace-import" className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer")}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Select File
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
