"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/constants";
import { toast } from "sonner";
import { MapPin, Phone, GripVertical } from "lucide-react";
import { AddLeadDialog } from "@/components/leads/add-lead-dialog";

interface Lead {
  id: number;
  firstName: string | null;
  lastName: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export default function PipelinePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    const res = await fetch("/api/leads?pageSize=500");
    const data = await res.json();
    setLeads(data.leads);
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    setDragOverStatus(status);
  };

  const handleDragLeave = () => {
    setDragOverStatus(null);
  };

  const handleDrop = async (e: React.DragEvent, status: string) => {
    e.preventDefault();
    setDragOverStatus(null);

    if (!draggedLead || draggedLead.status === status) return;

    // Optimistically update UI
    setLeads((prev) =>
      prev.map((l) =>
        l.id === draggedLead.id ? { ...l, status } : l
      )
    );

    await fetch(`/api/leads/${draggedLead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const statusLabel = LEAD_STATUSES.find((s) => s.value === status)?.label;
    toast.success(`Moved to ${statusLabel}`);
    setDraggedLead(null);
  };

  const getLeadsByStatus = (status: string) =>
    leads.filter((l) => l.status === status);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <AddLeadDialog onLeadCreated={fetchLeads} />
      </div>

      {/* Mobile: vertical stacked columns (no horizontal scroll) */}
      <div className="md:hidden space-y-4">
        {LEAD_STATUSES.map((status) => {
          const statusLeads = getLeadsByStatus(status.value);
          if (statusLeads.length === 0) return null;

          return (
            <div key={status.value} className="rounded-lg border bg-muted/30">
              <div className="p-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${status.color}`} />
                  <span className="font-medium text-sm">{status.label}</span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {statusLeads.length}
                </Badge>
              </div>
              <div className="p-2 space-y-2">
                {statusLeads.map((lead) => {
                  const name = [lead.firstName, lead.lastName]
                    .filter(Boolean)
                    .join(" ") || "Unknown";

                  return (
                    <Card
                      key={lead.id}
                      className="hover:border-primary/50 transition-colors"
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <CardContent className="p-3">
                        <p className="font-medium text-sm truncate">{name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{lead.propertyAddress}</span>
                        </p>
                        {lead.phone && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3 shrink-0" />
                            {lead.phone}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: horizontal kanban with drag-and-drop */}
      <div className="hidden md:flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 160px)" }}>
        {LEAD_STATUSES.map((status) => {
          const statusLeads = getLeadsByStatus(status.value);
          const isOver = dragOverStatus === status.value;

          return (
            <div
              key={status.value}
              className={`flex-shrink-0 w-72 rounded-lg border ${
                isOver ? "border-primary bg-primary/5" : "bg-muted/30"
              }`}
              onDragOver={(e) => handleDragOver(e, status.value)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, status.value)}
            >
              <div className="p-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${status.color}`} />
                  <span className="font-medium text-sm">{status.label}</span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {statusLeads.length}
                </Badge>
              </div>

              <div className="p-2 space-y-2 min-h-[200px]">
                {statusLeads.map((lead) => {
                  const name = [lead.firstName, lead.lastName]
                    .filter(Boolean)
                    .join(" ") || "Unknown";

                  return (
                    <Card
                      key={lead.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead)}
                      className="cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors"
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {name}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{lead.propertyAddress}</span>
                            </p>
                            {lead.phone && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3 shrink-0" />
                                {lead.phone}
                              </p>
                            )}
                          </div>
                          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
