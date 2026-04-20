"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { Upload, FileSpreadsheet, Check, AlertCircle } from "lucide-react";
import { CSV_COLUMN_MAPPINGS, LEAD_FIELD_OPTIONS } from "@/lib/constants";
import { toast } from "sonner";

type ImportState = "upload" | "mapping" | "importing" | "done";

export default function ImportPage() {
  const router = useRouter();
  const [state, setState] = useState<ImportState>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [allData, setAllData] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    total: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as Record<string, string>[];
        const cols = results.meta.fields || [];
        setHeaders(cols);
        setPreview(data.slice(0, 5));
        setAllData(data);

        // Auto-detect mappings
        const autoMapping: Record<string, string> = {};
        for (const col of cols) {
          const normalized = col.toLowerCase().trim();
          if (CSV_COLUMN_MAPPINGS[normalized]) {
            autoMapping[col] = CSV_COLUMN_MAPPINGS[normalized];
          } else {
            autoMapping[col] = "skip";
          }
        }
        setMapping(autoMapping);
        setState("mapping");
      },
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f && (f.name.endsWith(".csv") || f.type === "text/csv")) {
        handleFile(f);
      }
    },
    [handleFile]
  );

  const handleImport = async () => {
    setState("importing");
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: allData,
          mapping,
          filename: file?.name || "unknown.csv",
        }),
      });
      const result = await res.json();
      setResult(result);
      setState("done");
      toast.success(`Imported ${result.imported} leads`);
    } catch {
      toast.error("Import failed");
      setState("mapping");
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Import Leads from CSV</h1>

      {state === "upload" && (
        <Card>
          <CardContent className="pt-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25"
              }`}
            >
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2">
                Drag and drop your CSV file here
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                or click to browse
              </p>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                id="csv-upload"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <label htmlFor="csv-upload" className={cn(buttonVariants(), "cursor-pointer")}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Select CSV File
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {state === "mapping" && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                {file?.name} - {allData.length} rows found
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Map each CSV column to a lead field. Columns mapped to
                &quot;Skip&quot; will be stored as custom data.
              </p>
              <div className="space-y-3">
                {headers.map((header) => (
                  <div
                    key={header}
                    className="flex items-center gap-4"
                  >
                    <div className="w-48 text-sm font-medium truncate">
                      {header}
                    </div>
                    <div className="text-muted-foreground">→</div>
                    <Select
                      value={mapping[header] || "skip"}
                      onValueChange={(val) =>
                        val && setMapping((prev) => ({ ...prev, [header]: val }))
                      }
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_FIELD_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      e.g. {preview[0]?.[header] || "-"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Preview (first 5 rows)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHead key={h} className="text-xs whitespace-nowrap">
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row, i) => (
                      <TableRow key={i}>
                        {headers.map((h) => (
                          <TableCell key={h} className="text-xs whitespace-nowrap">
                            {row[h] || "-"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              onClick={handleImport}
              disabled={!Object.values(mapping).includes("propertyAddress")}
            >
              Import {allData.length} Leads
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setState("upload");
                setFile(null);
                setHeaders([]);
                setPreview([]);
                setAllData([]);
              }}
            >
              Cancel
            </Button>
            {!Object.values(mapping).includes("propertyAddress") && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                Property Address mapping is required
              </p>
            )}
          </div>
        </>
      )}

      {state === "importing" && (
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p>Importing leads...</p>
          </CardContent>
        </Card>
      )}

      {state === "done" && result && (
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Import Complete</h2>
            <div className="text-muted-foreground space-y-1">
              <p>Total rows: {result.total}</p>
              <p className="text-green-600 font-medium">
                Imported: {result.imported}
              </p>
              {result.skipped > 0 && (
                <p className="text-yellow-600">
                  Skipped (duplicates/no address): {result.skipped}
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-center mt-6">
              <Button onClick={() => router.push("/leads")}>
                View Leads
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setState("upload");
                  setFile(null);
                  setResult(null);
                }}
              >
                Import More
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
