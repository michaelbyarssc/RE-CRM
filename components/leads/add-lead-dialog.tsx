"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STATUSES } from "@/lib/constants";
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface AddLeadDialogProps {
  onLeadCreated: () => void;
}

const initialForm = {
  firstName: "",
  lastName: "",
  propertyAddress: "",
  propertyCity: "",
  propertyState: "",
  propertyZip: "",
  mailingAddress: "",
  mailingCity: "",
  mailingState: "",
  mailingZip: "",
  phone: "",
  email: "",
  status: "new",
};

export function AddLeadDialog({ onLeadCreated }: AddLeadDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.propertyAddress.trim()) {
      toast.error("Property address is required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create lead");
      }

      toast.success("Lead created successfully");
      setForm(initialForm);
      setOpen(false);
      onLeadCreated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create lead"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          {/* Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => updateField("lastName", e.target.value)}
                placeholder="Doe"
              />
            </div>
          </div>

          {/* Property Address */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Property Address
            </h3>
            <div className="space-y-2">
              <Label htmlFor="propertyAddress">
                Street Address <span className="text-destructive">*</span>
              </Label>
              <Input
                id="propertyAddress"
                value={form.propertyAddress}
                onChange={(e) => updateField("propertyAddress", e.target.value)}
                placeholder="123 Main St"
                required
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="propertyCity">City</Label>
                <Input
                  id="propertyCity"
                  value={form.propertyCity}
                  onChange={(e) => updateField("propertyCity", e.target.value)}
                  placeholder="Tampa"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="propertyState">State</Label>
                <Input
                  id="propertyState"
                  value={form.propertyState}
                  onChange={(e) => updateField("propertyState", e.target.value)}
                  placeholder="FL"
                  maxLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="propertyZip">Zip</Label>
                <Input
                  id="propertyZip"
                  value={form.propertyZip}
                  onChange={(e) => updateField("propertyZip", e.target.value)}
                  placeholder="33601"
                />
              </div>
            </div>
          </div>

          {/* Mailing Address */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Mailing Address
            </h3>
            <div className="space-y-2">
              <Label htmlFor="mailingAddress">Street Address</Label>
              <Input
                id="mailingAddress"
                value={form.mailingAddress}
                onChange={(e) => updateField("mailingAddress", e.target.value)}
                placeholder="456 Oak Ave"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="mailingCity">City</Label>
                <Input
                  id="mailingCity"
                  value={form.mailingCity}
                  onChange={(e) => updateField("mailingCity", e.target.value)}
                  placeholder="Tampa"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mailingState">State</Label>
                <Input
                  id="mailingState"
                  value={form.mailingState}
                  onChange={(e) => updateField("mailingState", e.target.value)}
                  placeholder="FL"
                  maxLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mailingZip">Zip</Label>
                <Input
                  id="mailingZip"
                  value={form.mailingZip}
                  onChange={(e) => updateField("mailingZip", e.target.value)}
                  placeholder="33601"
                />
              </div>
            </div>
          </div>

          {/* Contact & Status */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Contact & Status
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder="john@example.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => v && updateField("status", v)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${s.color}`}
                        />
                        {s.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Lead"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
