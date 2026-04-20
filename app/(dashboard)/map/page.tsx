"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STATUSES } from "@/lib/constants";
import { toast } from "sonner";
import { MapPin, RefreshCw } from "lucide-react";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-[600px] bg-muted rounded-lg flex items-center justify-center">Loading map...</div> }
);

export default function MapPage() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [ungeocoded, setUngeocoded] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [geocoding, setGeocoding] = useState(false);

  const fetchMapData = useCallback(async () => {
    const res = await fetch("/api/leads/geocode");
    const data = await res.json();
    setLeads(data.leads);
    setTotal(data.total);
    setUngeocoded(data.ungeocoded);
  }, []);

  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const res = await fetch("/api/leads/geocode", { method: "POST" });
      const data = await res.json();
      toast.success(`Geocoded ${data.geocoded} leads. ${data.remaining} remaining.`);
      fetchMapData();
    } catch {
      toast.error("Geocoding failed");
    }
    setGeocoding(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Map View</h1>
          <p className="text-sm text-muted-foreground">
            <MapPin className="h-3 w-3 inline mr-1" />
            {leads.length} of {total} leads on map
            {ungeocoded > 0 && ` (${ungeocoded} need geocoding)`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {LEAD_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.color}`} />
                    {s.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ungeocoded > 0 && (
            <Button onClick={handleGeocode} disabled={geocoding} size="sm">
              <RefreshCw className={`h-4 w-4 mr-2 ${geocoding ? "animate-spin" : ""}`} />
              {geocoding ? "Geocoding..." : `Geocode ${ungeocoded} leads`}
            </Button>
          )}
        </div>
      </div>

      <MapView leads={leads} statusFilter={statusFilter} />

      <div className="flex gap-4 mt-3 flex-wrap">
        {LEAD_STATUSES.map((s) => (
          <div key={s.value} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-3 h-3 rounded-full ${s.color}`} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
