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

const STATUS_COLORS: Record<string, string> = {
  new: "#3B82F6",
  contacted: "#EAB308",
  in_process: "#A855F7",
  offer_sent: "#F97316",
  under_contract: "#10B981",
  closed: "#16A34A",
  dead: "#6B7280",
};

// Distinct colors for buyer zones
const BUYER_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  "#F0B27A", "#82E0AA", "#F1948A", "#85929E", "#73C6B6",
];

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

// Check if a lead is within range of a buyer zone area (approx 8 mile radius)
function isWithinRange(
  leadLat: number,
  leadLng: number,
  areaLat: number,
  areaLng: number,
  radiusKm: number = 13 // ~8 miles
): boolean {
  const R = 6371; // Earth's radius in km
  const dLat = ((areaLat - leadLat) * Math.PI) / 180;
  const dLng = ((areaLng - leadLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((leadLat * Math.PI) / 180) *
      Math.cos((areaLat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance <= radiusKm;
}

function findMatchingBuyers(
  lead: MapLead,
  buyerZones: BuyerZone[]
): BuyerZone[] {
  return buyerZones.filter((buyer) =>
    buyer.geocodedAreas.some((area) =>
      isWithinRange(lead.latitude, lead.longitude, area.lat, area.lng)
    )
  );
}

export function MapView({
  leads,
  statusFilter,
  buyerZones = [],
  showBuyerZones = false,
}: {
  leads: MapLead[];
  statusFilter: string;
  buyerZones?: BuyerZone[];
  showBuyerZones?: boolean;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const buyerLayerRef = useRef<L.LayerGroup | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    leafletMap.current = L.map(mapRef.current).setView([39.8283, -98.5795], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(leafletMap.current);

    markersRef.current = L.layerGroup().addTo(leafletMap.current);
    buyerLayerRef.current = L.layerGroup().addTo(leafletMap.current);

    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, []);

  // Update buyer zone circles
  useEffect(() => {
    if (!leafletMap.current || !buyerLayerRef.current) return;

    buyerLayerRef.current.clearLayers();

    if (!showBuyerZones) return;

    buyerZones.forEach((buyer, index) => {
      const color = BUYER_COLORS[index % BUYER_COLORS.length];

      buyer.geocodedAreas.forEach((area) => {
        // Draw circle (~8 mile radius = ~13km)
        const circle = L.circle([area.lat, area.lng], {
          radius: 13000, // meters
          color: color,
          fillColor: color,
          fillOpacity: 0.12,
          weight: 2,
          dashArray: "6 4",
        });

        // Popup for buyer zone
        circle.bindPopup(`
          <div style="min-width: 180px; font-family: system-ui, sans-serif;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <div style="width: 12px; height: 12px; border-radius: 50%; background: ${color}; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
              <strong style="font-size: 13px;">🏠 ${buyer.name}</strong>
            </div>
            ${buyer.company ? `<span style="color: #666; font-size: 11px;">${buyer.company}</span><br/>` : ""}
            <span style="color: #666; font-size: 12px;">Area: ${area.name}</span><br/>
            ${buyer.priceRange ? `<span style="color: #666; font-size: 12px;">Budget: ${buyer.priceRange}</span><br/>` : ""}
            ${buyer.phone ? `<a href="tel:${buyer.phone}" style="font-size: 12px;">📞 ${buyer.phone}</a><br/>` : ""}
            ${buyer.email ? `<a href="mailto:${buyer.email}" style="font-size: 12px;">✉️ ${buyer.email}</a><br/>` : ""}
            <a href="/buyers" style="font-size: 11px; margin-top: 4px; display: inline-block; color: #3B82F6;">View Buyer →</a>
          </div>
        `);

        circle.addTo(buyerLayerRef.current!);

        // Add small label marker at center
        const label = L.marker([area.lat, area.lng], {
          icon: L.divIcon({
            className: "buyer-zone-label",
            html: `<div style="
              background: ${color}; color: white; padding: 2px 6px;
              border-radius: 4px; font-size: 10px; font-weight: 600;
              white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              border: 1px solid rgba(255,255,255,0.5);
            ">${buyer.name.split(" ")[0]} — ${area.name}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, -15],
          }),
          interactive: false,
        });
        label.addTo(buyerLayerRef.current!);
      });
    });
  }, [buyerZones, showBuyerZones]);

  // Update lead markers
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

      // Find matching buyers
      const matchingBuyers = showBuyerZones ? findMatchingBuyers(lead, buyerZones) : [];

      let buyerMatchHtml = "";
      if (matchingBuyers.length > 0) {
        const buyerListItems = matchingBuyers.map((b, i) => {
          const color = BUYER_COLORS[buyerZones.indexOf(b) % BUYER_COLORS.length];
          return `<div style="display: flex; align-items: center; gap: 4px; padding: 2px 0;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></div>
            <span>${b.name}${b.priceRange ? ` (${b.priceRange})` : ""}</span>
          </div>`;
        }).join("");
        buyerMatchHtml = `
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #e5e7eb;">
            <strong style="font-size: 11px; color: #16A34A;">✅ Interested Buyers:</strong>
            <div style="font-size: 11px; margin-top: 2px;">${buyerListItems}</div>
          </div>
        `;
      } else if (showBuyerZones && buyerZones.length > 0) {
        buyerMatchHtml = `
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #e5e7eb;">
            <span style="font-size: 11px; color: #9CA3AF;">No matching buyers for this area</span>
          </div>
        `;
      }

      const marker = L.marker([lead.latitude, lead.longitude], {
        icon: createMarkerIcon(lead.status),
      });

      marker.bindPopup(`
        <div style="min-width: 220px; font-family: system-ui, sans-serif;">
          <strong style="font-size: 14px;">${name}</strong><br/>
          <span style="color: #666; font-size: 12px;">${lead.propertyAddress}</span><br/>
          <span style="color: #666; font-size: 12px;">${[lead.propertyCity, lead.propertyState, lead.propertyZip].filter(Boolean).join(", ")}</span><br/>
          ${lead.phone ? `<a href="tel:${lead.phone}" style="font-size: 12px;">📞 ${lead.phone}</a><br/>` : ""}
          <span style="display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 9999px; font-size: 11px; color: white; background-color: ${STATUS_COLORS[lead.status] || "#6B7280"};">${statusLabel}</span>
          <br/><a href="/leads/${lead.id}" style="font-size: 12px; margin-top: 4px; display: inline-block;">View Details →</a>
          ${buyerMatchHtml}
        </div>
      `);

      marker.addTo(markersRef.current!);
      bounds.push([lead.latitude, lead.longitude]);
    }

    if (bounds.length > 0) {
      leafletMap.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }, [leads, statusFilter, buyerZones, showBuyerZones]);

  return (
    <div
      ref={mapRef}
      style={{ height: "calc(100vh - 200px)", minHeight: "400px", width: "100%", borderRadius: "8px" }}
    />
  );
}
