"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STATUSES } from "@/lib/constants";
import { toast } from "sonner";
import { MapPin, RefreshCw, UserCheck } from "lucide-react";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-[600px] bg-muted rounded-lg flex items-center justify-center">Loading map...</div> }
);

// Buyer zone colors (must match map-view.tsx)
const BUYER_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  "#F0B27A", "#82E0AA", "#F1948A", "#85929E", "#73C6B6",
];

interface BuyerZone {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  priceRange: string | null;
  areas: string;
  geocodedAreas: { name: string; lat: number; lng: number; type: string }[];
}

export default function MapPage() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [ungeocoded, setUngeocoded] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [geocoding, setGeocoding] = useState(false);
  const [buyerZones, setBuyerZones] = useState<BuyerZone[]>([]);
  const [showBuyerZones, setShowBuyerZones] = useState(false);

  const fetchMapData = useCallback(async () => {
    const res = await fetch("/api/leads/geocode");
    const data = await res.json();
    setLeads(data.leads);
    setTotal(data.total);
    setUngeocoded(data.ungeocoded);
  }, []);

  const fetchBuyerZones = useCallback(async () => {
    const res = await fetch("/api/buyers/zones");
    if (res.ok) {
      const data = await res.json();
      setBuyerZones(data);
    }
  }, []);

  useEffect(() => {
    fetchMapData();
    fetchBuyerZones();
  }, [fetchMapData, fetchBuyerZones]);

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
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between relative z-[1000]">
        <div>
          <h1 className="text-2xl font-bold">Map View</h1>
          <p className="text-sm text-muted-foreground">
            <MapPin className="h-3 w-3 inline mr-1" />
            {leads.length} of {total} leads on map
            {ungeocoded > 0 && ` (${ungeocoded} need geocoding)`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={showBuyerZones ? "default" : "outline"}
            size="sm"
            onClick={() => setShowBuyerZones(!showBuyerZones)}
            disabled={buyerZones.length === 0}
          >
            <UserCheck className="h-4 w-4 mr-2" />
            {showBuyerZones ? "Buyer Zones ON" : "Buyer Zones"}
            {buyerZones.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {buyerZones.length}
              </Badge>
            )}
          </Button>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-full sm:w-[160px]">
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

      <MapView
        leads={leads}
        statusFilter={statusFilter}
        buyerZones={buyerZones}
        showBuyerZones={showBuyerZones}
      />

      {/* Legends */}
      <div className="mt-3 space-y-2">
        {/* Status legend */}
        <div className="flex gap-4 flex-wrap">
          {LEAD_STATUSES.map((s) => (
            <div key={s.value} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-3 h-3 rounded-full ${s.color}`} />
              {s.label}
            </div>
          ))}
        </div>

        {/* Buyer zones legend */}
        {showBuyerZones && buyerZones.length > 0 && (
          <div className="border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Buyer Coverage Zones:</p>
            <div className="flex gap-4 flex-wrap">
              {buyerZones.map((buyer, i) => (
                <div key={buyer.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="w-3 h-3 rounded-full border border-white"
                    style={{ backgroundColor: BUYER_COLORS[i % BUYER_COLORS.length], opacity: 0.8 }}
                  />
                  {buyer.name}
                  {buyer.priceRange && <span className="text-[10px]">({buyer.priceRange})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {buyerZones.length === 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            <UserCheck className="h-3 w-3 inline mr-1" />
            Add buyers with areas on the <a href="/buyers" className="underline">Buyers page</a> to see coverage zones on the map.
          </p>
        )}
      </div>
    </div>
  );
}
