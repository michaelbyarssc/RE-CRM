"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Phone,
  PhoneOff,
  SkipForward,
  User,
  MapPin,
  ChevronRight,
} from "lucide-react";

interface Lead {
  id: number;
  firstName: string | null;
  lastName: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  propertyState: string | null;
  phone: string | null;
  status: string;
}

const DISPOSITIONS = [
  { value: "answered", label: "Answered" },
  { value: "voicemail", label: "Voicemail" },
  { value: "no_answer", label: "No Answer" },
  { value: "busy", label: "Busy" },
  { value: "wrong_number", label: "Wrong Number" },
  { value: "disconnected", label: "Disconnected" },
];

export default function DialerPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [powerMode, setPowerMode] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [disposition, setDisposition] = useState("answered");
  const [callNotes, setCallNotes] = useState("");
  const [statusFilter, setStatusFilter] = useState("new");

  const fetchLeads = useCallback(async () => {
    const res = await fetch(`/api/leads?status=${statusFilter}&pageSize=100`);
    const data = await res.json();
    // Only leads with phone numbers
    setLeads(data.leads.filter((l: Lead) => l.phone));
  }, [statusFilter]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const currentLead = leads[currentIndex];

  const handleCall = (lead: Lead) => {
    window.open(`tel:${lead.phone}`, "_self");
    // Show log dialog after a brief delay
    setTimeout(() => setLogOpen(true), 1000);
  };

  const handleLogCall = async () => {
    if (!currentLead) return;
    await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: currentLead.id,
        disposition,
        notes: callNotes,
        direction: "outbound",
      }),
    });
    toast.success("Call logged");
    setLogOpen(false);
    setCallNotes("");
    setDisposition("answered");

    if (powerMode && currentIndex < leads.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleSkip = () => {
    if (currentIndex < leads.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Dialer</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-[140px]">
              {statusFilter === "new" ? "New" : statusFilter === "contacted" ? "Contacted" : "In Process"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="in_process">In Process</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={powerMode ? "default" : "outline"}
            onClick={() => {
              setPowerMode(!powerMode);
              setCurrentIndex(0);
            }}
          >
            <Phone className="h-4 w-4 mr-2" />
            {powerMode ? "Power Dialer ON" : "Power Dialer"}
          </Button>
        </div>
      </div>

      {powerMode && currentLead ? (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {[currentLead.firstName, currentLead.lastName]
                  .filter(Boolean)
                  .join(" ") || "Unknown"}
              </CardTitle>
              <Badge variant="outline">
                {currentIndex + 1} of {leads.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 mb-4">
              <p className="text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {currentLead.propertyAddress}
                {currentLead.propertyCity && `, ${currentLead.propertyCity}`}
                {currentLead.propertyState && `, ${currentLead.propertyState}`}
              </p>
              <p className="text-lg font-mono flex items-center gap-2">
                <Phone className="h-4 w-4" />
                {currentLead.phone}
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => handleCall(currentLead)} className="flex-1">
                <Phone className="h-4 w-4 mr-2" />
                Call Now
              </Button>
              <Button variant="outline" onClick={handleSkip}>
                <SkipForward className="h-4 w-4 mr-2" />
                Skip
              </Button>
              <Button variant="outline" onClick={() => setLogOpen(true)}>
                Log Call
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : !powerMode ? (
        <p className="text-sm text-muted-foreground mb-4">
          Click a phone number to call, or enable Power Dialer to cycle through leads.
        </p>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <PhoneOff className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No leads with phone numbers in this status.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Lead list with click-to-call */}
      <div className="space-y-2">
        {leads.map((lead, i) => (
          <Card
            key={lead.id}
            className={`cursor-pointer transition-colors ${
              powerMode && i === currentIndex ? "border-primary" : "hover:bg-accent"
            }`}
          >
            <CardContent className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-sm">
                  {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown"}
                </p>
                <p className="text-xs text-muted-foreground">{lead.propertyAddress}</p>
              </div>
              <div className="flex items-center gap-2">
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline">
                      <Phone className="h-3 w-3 mr-1" />
                      {lead.phone}
                    </Button>
                  </a>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Call Log Dialog */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Call</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {currentLead && (
              <p className="text-sm text-muted-foreground">
                {[currentLead.firstName, currentLead.lastName].filter(Boolean).join(" ")} - {currentLead.phone}
              </p>
            )}
            <div>
              <Label>Disposition</Label>
              <Select value={disposition} onValueChange={(v) => v && setDisposition(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPOSITIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                placeholder="Call notes..."
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleLogCall} className="flex-1">
                Save Call Log
              </Button>
              <Button variant="outline" onClick={() => setLogOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
