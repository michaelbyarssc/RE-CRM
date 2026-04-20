"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { EVENT_TYPES, EVENT_STATUSES } from "@/lib/constants";
import { toast } from "sonner";
import { Plus, Loader2, MapPin, User, UserCheck } from "lucide-react";

interface EventFormData {
  title: string;
  description: string;
  eventType: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  status: string;
  leadId: number | null;
  buyerId: number | null;
}

interface LeadOption {
  id: number;
  firstName: string | null;
  lastName: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  phone: string | null;
}

interface BuyerOption {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
}

interface EventFormDialogProps {
  onEventCreated: () => void;
  defaultDate?: string;
  defaultEventType?: string;
  defaultLeadId?: number | null;
  defaultBuyerId?: number | null;
  editEvent?: {
    id: number;
    title: string;
    description: string | null;
    eventType: string;
    startAt: string;
    endAt: string | null;
    allDay: number | null;
    location: string | null;
    status: string;
    leadId: number | null;
    buyerId: number | null;
  } | null;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function toLocalDatetime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDate(iso: string) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function EventFormDialog({
  onEventCreated,
  defaultDate,
  defaultEventType,
  defaultLeadId,
  defaultBuyerId,
  editEvent,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: EventFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EventFormData>({
    title: "",
    description: "",
    eventType: defaultEventType || "appointment",
    startAt: defaultDate ? toLocalDatetime(defaultDate) : "",
    endAt: "",
    allDay: false,
    location: "",
    status: "scheduled",
    leadId: defaultLeadId || null,
    buyerId: defaultBuyerId || null,
  });

  // Lead/Buyer search
  const [leadSearch, setLeadSearch] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [buyerOptions, setBuyerOptions] = useState<BuyerOption[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerOption | null>(null);
  const [showLeadSearch, setShowLeadSearch] = useState(false);
  const [showBuyerSearch, setShowBuyerSearch] = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (editEvent && open) {
      setForm({
        title: editEvent.title,
        description: editEvent.description || "",
        eventType: editEvent.eventType,
        startAt: editEvent.allDay ? toLocalDate(editEvent.startAt) : toLocalDatetime(editEvent.startAt),
        endAt: editEvent.endAt ? (editEvent.allDay ? toLocalDate(editEvent.endAt) : toLocalDatetime(editEvent.endAt)) : "",
        allDay: editEvent.allDay === 1,
        location: editEvent.location || "",
        status: editEvent.status,
        leadId: editEvent.leadId,
        buyerId: editEvent.buyerId,
      });
    }
  }, [editEvent, open]);

  // Search leads
  useEffect(() => {
    if (!showLeadSearch) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/calendar/search?type=leads&q=${encodeURIComponent(leadSearch)}`);
      if (res.ok) setLeadOptions(await res.json());
    }, 200);
    return () => clearTimeout(timer);
  }, [leadSearch, showLeadSearch]);

  // Search buyers
  useEffect(() => {
    if (!showBuyerSearch) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/calendar/search?type=buyers&q=${encodeURIComponent(buyerSearch)}`);
      if (res.ok) setBuyerOptions(await res.json());
    }, 200);
    return () => clearTimeout(timer);
  }, [buyerSearch, showBuyerSearch]);

  const resetForm = () => {
    setForm({
      title: "",
      description: "",
      eventType: defaultEventType || "appointment",
      startAt: "",
      endAt: "",
      allDay: false,
      location: "",
      status: "scheduled",
      leadId: null,
      buyerId: null,
    });
    setSelectedLead(null);
    setSelectedBuyer(null);
    setShowLeadSearch(false);
    setShowBuyerSearch(false);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.startAt) {
      toast.error("Title and start date are required");
      return;
    }

    setSaving(true);
    try {
      const startAt = form.allDay
        ? new Date(form.startAt + "T00:00:00").toISOString()
        : new Date(form.startAt).toISOString();
      const endAt = form.endAt
        ? form.allDay
          ? new Date(form.endAt + "T23:59:59").toISOString()
          : new Date(form.endAt).toISOString()
        : null;

      const payload = {
        title: form.title,
        description: form.description || null,
        eventType: form.eventType,
        startAt,
        endAt,
        allDay: form.allDay,
        location: form.location || null,
        status: form.status,
        leadId: form.leadId,
        buyerId: form.buyerId,
      };

      if (editEvent) {
        await fetch(`/api/calendar/${editEvent.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Event updated");
      } else {
        await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Event created");
      }

      setOpen(false);
      resetForm();
      onEventCreated();
    } catch {
      toast.error("Failed to save event");
    } finally {
      setSaving(false);
    }
  };

  const eventTypeInfo = EVENT_TYPES.find((t) => t.value === form.eventType);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      {trigger && <DialogTrigger>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editEvent ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Title */}
          <div>
            <Label>Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Walk property at 123 Main St"
            />
          </div>

          {/* Event Type + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.eventType} onValueChange={(v) => v && setForm({ ...form, eventType: v })}>
                <SelectTrigger>
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${eventTypeInfo?.color}`} />
                    {eventTypeInfo?.label ?? form.eventType}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${t.color}`} />
                        {t.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => v && setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <span>{EVENT_STATUSES.find((s) => s.value === form.status)?.label ?? form.status}</span>
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* All Day */}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.allDay}
              onCheckedChange={(v) => setForm({ ...form, allDay: !!v })}
            />
            <Label className="cursor-pointer">All day event</Label>
          </div>

          {/* Date/Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start *</Label>
              <Input
                type={form.allDay ? "date" : "datetime-local"}
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
            </div>
            <div>
              <Label>End</Label>
              <Input
                type={form.allDay ? "date" : "datetime-local"}
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </div>
          </div>

          {/* Location */}
          {(form.eventType === "appointment" || form.eventType === "closing") && (
            <div>
              <Label className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Location
              </Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Property address or meeting location"
              />
            </div>
          )}

          {/* Description */}
          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Additional details..."
              rows={2}
            />
          </div>

          {/* Link to Lead */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <User className="h-3.5 w-3.5" /> Link to Lead
            </Label>
            {form.leadId && selectedLead ? (
              <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {[selectedLead.firstName, selectedLead.lastName].filter(Boolean).join(" ") || "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{selectedLead.propertyAddress}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setForm({ ...form, leadId: null }); setSelectedLead(null); }}>
                  Remove
                </Button>
              </div>
            ) : (
              <div>
                {showLeadSearch ? (
                  <div className="space-y-1">
                    <Input
                      placeholder="Search by name, address, phone..."
                      value={leadSearch}
                      onChange={(e) => setLeadSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="max-h-32 overflow-y-auto border rounded-md">
                      {leadOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-2">No leads found</p>
                      ) : (
                        leadOptions.map((lead) => (
                          <button
                            key={lead.id}
                            className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                            onClick={() => {
                              setForm({ ...form, leadId: lead.id });
                              setSelectedLead(lead);
                              setShowLeadSearch(false);
                              // Auto-fill location from lead address
                              if (!form.location && lead.propertyAddress) {
                                setForm((f) => ({
                                  ...f,
                                  leadId: lead.id,
                                  location: [lead.propertyAddress, lead.propertyCity].filter(Boolean).join(", "),
                                }));
                              }
                            }}
                          >
                            <span className="font-medium">
                              {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown"}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">{lead.propertyAddress}</span>
                          </button>
                        ))
                      )}
                    </div>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowLeadSearch(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => { setShowLeadSearch(true); setLeadSearch(""); }}>
                    <User className="h-3.5 w-3.5 mr-1.5" /> Select Lead
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Link to Buyer */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <UserCheck className="h-3.5 w-3.5" /> Link to Buyer
            </Label>
            {form.buyerId && selectedBuyer ? (
              <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedBuyer.name}</p>
                  {selectedBuyer.company && (
                    <p className="text-xs text-muted-foreground truncate">{selectedBuyer.company}</p>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setForm({ ...form, buyerId: null }); setSelectedBuyer(null); }}>
                  Remove
                </Button>
              </div>
            ) : (
              <div>
                {showBuyerSearch ? (
                  <div className="space-y-1">
                    <Input
                      placeholder="Search by name, company..."
                      value={buyerSearch}
                      onChange={(e) => setBuyerSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="max-h-32 overflow-y-auto border rounded-md">
                      {buyerOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-2">No buyers found</p>
                      ) : (
                        buyerOptions.map((buyer) => (
                          <button
                            key={buyer.id}
                            className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                            onClick={() => {
                              setForm({ ...form, buyerId: buyer.id });
                              setSelectedBuyer(buyer);
                              setShowBuyerSearch(false);
                            }}
                          >
                            <span className="font-medium">{buyer.name}</span>
                            {buyer.company && (
                              <span className="text-xs text-muted-foreground ml-2">{buyer.company}</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowBuyerSearch(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => { setShowBuyerSearch(true); setBuyerSearch(""); }}>
                    <UserCheck className="h-3.5 w-3.5 mr-1.5" /> Select Buyer
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          <Button onClick={handleSubmit} disabled={saving || !form.title.trim() || !form.startAt} className="w-full">
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : editEvent ? (
              "Update Event"
            ) : (
              <><Plus className="h-4 w-4 mr-2" />Create Event</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
