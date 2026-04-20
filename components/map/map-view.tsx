"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STATUS_MAP, type LeadStatus } from "@/lib/constants";

interface MapLead {
  id: number;
  firstName: string | null;
  lastName: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  phone: string | null;
  status: string;
  latitude: number;
  longitude: number;
}

const STATUS_COLORS: Record<string, string> = {
  new: "#3B82F6",
  contacted: "#EAB308",
  in_process: "#A855F7",
  offer_sent: "#F97316",
  under_contract: "#10B981",
  closed: "#16A34A",
  dead: "#6B7280",
};

function createMarkerIcon(status: string) {
  const color = STATUS_COLORS[status] || "#6B7280";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: 24px; height: 24px; border-radius: 50%;
      background-color: ${color}; border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

export function MapView({
  leads,
  statusFilter,
}: {
  leads: MapLead[];
  statusFilter: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    leafletMap.current = L.map(mapRef.current).setView([39.8283, -98.5795], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(leafletMap.current);

    markersRef.current = L.layerGroup().addTo(leafletMap.current);

    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    if (!leafletMap.current || !markersRef.current) return;

    markersRef.current.clearLayers();

    const filtered = statusFilter === "all"
      ? leads
      : leads.filter((l) => l.status === statusFilter);

    const bounds: [number, number][] = [];

    for (const lead of filtered) {
      const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
      const statusInfo = STATUS_MAP[lead.status as LeadStatus];
      const statusLabel = statusInfo?.label || lead.status;

      const marker = L.marker([lead.latitude, lead.longitude], {
        icon: createMarkerIcon(lead.status),
      });

      marker.bindPopup(`
        <div style="min-width: 200px; font-family: system-ui, sans-serif;">
          <strong style="font-size: 14px;">${name}</strong><br/>
          <span style="color: #666; font-size: 12px;">${lead.propertyAddress}</span><br/>
          <span style="color: #666; font-size: 12px;">${[lead.propertyCity, lead.propertyState, lead.propertyZip].filter(Boolean).join(", ")}</span><br/>
          ${lead.phone ? `<a href="tel:${lead.phone}" style="font-size: 12px;">📞 ${lead.phone}</a><br/>` : ""}
          <span style="display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 9999px; font-size: 11px; color: white; background-color: ${STATUS_COLORS[lead.status] || "#6B7280"};">${statusLabel}</span>
          <br/><a href="/leads/${lead.id}" style="font-size: 12px; margin-top: 4px; display: inline-block;">View Details →</a>
        </div>
      `);

      marker.addTo(markersRef.current!);
      bounds.push([lead.latitude, lead.longitude]);
    }

    if (bounds.length > 0) {
      leafletMap.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }, [leads, statusFilter]);

  return (
    <div
      ref={mapRef}
      style={{ height: "calc(100vh - 160px)", width: "100%", borderRadius: "8px" }}
    />
  );
}
