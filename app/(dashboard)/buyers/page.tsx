"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Phone, Mail, UserCheck, MapPin, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Buyer {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  buyCriteria: string | null;
  notes: string | null;
  createdAt: string;
}

// The areas text with the "On Map" badge (or "Map Areas" button) glued to its
// last word, so the badge never drops onto a line of its own.
function AreasLine({ areas, children }: { areas: string; children: React.ReactNode }) {
  const words = `Areas: ${areas}`.trim().split(/\s+/);
  const last = words.pop();
  return (
    <span>
      {words.join(" ")}{" "}
      <span className="whitespace-nowrap">
        {last}{" "}
        {children}
      </span>
    </span>
  );
}

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
    areas: "",
    priceRange: "",
    notes: "",
  });

  const fetchBuyers = useCallback(async () => {
    const res = await fetch("/api/buyers");
    if (res.ok) setBuyers(await res.json());
  }, []);

  useEffect(() => {
    fetchBuyers();
  }, [fetchBuyers]);

  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/buyers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          company: form.company || null,
          phone: form.phone || null,
          email: form.email || null,
          buyCriteria: { areas: form.areas, priceRange: form.priceRange },
          notes: form.notes || null,
        }),
      });
      const buyer = await res.json();

      // Auto-geocode buyer areas for the map if areas were provided
      if (form.areas.trim()) {
        toast.success("Buyer added! Geocoding areas for map...");
        fetch("/api/buyers/zones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buyerId: buyer.id }),
        }).then((geoRes) => geoRes.json()).then((geoData) => {
          if (geoData.geocoded > 0) {
            toast.success(`Mapped ${geoData.geocoded} buying area${geoData.geocoded > 1 ? "s" : ""} to the map`);
          }
          fetchBuyers();
        });
      } else {
        toast.success("Buyer added");
        fetchBuyers();
      }

      setOpen(false);
      setForm({ name: "", company: "", phone: "", email: "", areas: "", priceRange: "", notes: "" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this buyer?")) return;
    await fetch(`/api/buyers?id=${id}`, { method: "DELETE" });
    toast.success("Buyer removed");
    fetchBuyers();
  };

  const handleGeocodeAreas = async (buyerId: number) => {
    toast.info("Geocoding areas for map...");
    const res = await fetch("/api/buyers/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyerId }),
    });
    const data = await res.json();
    if (data.geocoded > 0) {
      toast.success(`Mapped ${data.geocoded} area${data.geocoded > 1 ? "s" : ""} to the map`);
    } else {
      toast.error("Could not geocode any areas");
    }
    fetchBuyers();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Buyers List</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Buyer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Cash Buyer</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Buyer name" />
                </div>
                <div>
                  <Label>Company</Label>
                  <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email address" />
                </div>
              </div>
              <div>
                <Label className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  Buying Areas (zip codes, cities, counties)
                </Label>
                <Input
                  value={form.areas}
                  onChange={(e) => setForm({ ...form, areas: e.target.value })}
                  placeholder="e.g. 29307, 29301, Spartanburg, Greenville County"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Separate with commas. These will show as zones on the Map view.
                </p>
              </div>
              <div>
                <Label>Price Range</Label>
                <Input value={form.priceRange} onChange={(e) => setForm({ ...form, priceRange: e.target.value })} placeholder="e.g. $50k-$150k" />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Property types, preferences..." />
              </div>
              <Button onClick={handleCreate} disabled={!form.name.trim() || creating}>
                {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding...</> : "Add Buyer"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {buyers.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <UserCheck className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No buyers yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add cash buyers to match with your deals</p>
          </CardContent>
        </Card>
      ) : (
        // Cards or table by the width the list really has (the side menu takes
        // 256 px), not by the screen width. With ordinary data the table needs
        // about 850 px, so it shows from 900 px; narrower lists get the cards.
        <div className="@container">
          {/* Card view */}
          <div data-buyers-view="cards" className="@min-[900px]:hidden grid gap-3 @min-[600px]:grid-cols-2">
            {buyers.map((buyer) => {
              const criteria = buyer.buyCriteria ? JSON.parse(buyer.buyCriteria) : null;
              return (
                <Card key={buyer.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium">{buyer.name}</p>
                        {buyer.company && (
                          <p className="text-sm text-muted-foreground">{buyer.company}</p>
                        )}
                      </div>
                      <button onClick={() => handleDelete(buyer.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="space-y-1.5 mt-3">
                      {buyer.phone && (
                        <a href={`tel:${buyer.phone}`} className="flex items-center gap-2 text-sm hover:underline">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />{buyer.phone}
                        </a>
                      )}
                      {buyer.email && (
                        <a href={`mailto:${buyer.email}`} className="flex items-center gap-2 text-sm hover:underline">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />{buyer.email}
                        </a>
                      )}
                    </div>
                    {criteria && (criteria.areas || criteria.priceRange) && (
                      <div className="mt-3 pt-3 border-t text-sm text-muted-foreground">
                        {criteria.areas && (
                          <div className="flex items-start gap-1.5">
                            <MapPin className="h-3.5 w-3.5 mt-[5px] shrink-0" />
                            <AreasLine areas={criteria.areas}>
                              {criteria.geocodedAreas?.length > 0 ? (
                                <Badge variant="outline" className="text-base text-green-600 border-green-300 align-[-2px]">
                                  On Map
                                </Badge>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-5 text-base px-1.5 align-[-2px]"
                                  onClick={(e) => { e.stopPropagation(); handleGeocodeAreas(buyer.id); }}
                                >
                                  <MapPin className="h-3 w-3 mr-1" />Map Areas
                                </Button>
                              )}
                            </AreasLine>
                          </div>
                        )}
                        {criteria.priceRange && <p>Price: {criteria.priceRange}</p>}
                      </div>
                    )}
                    {buyer.notes && (
                      <p className="mt-2 text-sm text-muted-foreground italic">{buyer.notes}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Table view */}
          <div data-buyers-view="table" className="hidden @min-[900px]:block border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Buy Criteria</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.map((buyer) => {
                  const criteria = buyer.buyCriteria ? JSON.parse(buyer.buyCriteria) : null;
                  return (
                    <TableRow key={buyer.id}>
                      <TableCell className="font-medium">{buyer.name}</TableCell>
                      <TableCell className="whitespace-normal">{buyer.company || "-"}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {buyer.phone && (
                            <a href={`tel:${buyer.phone}`} className="flex items-center gap-1 text-xs hover:underline">
                              <Phone className="h-3 w-3" />{buyer.phone}
                            </a>
                          )}
                          {buyer.email && (
                            <a href={`mailto:${buyer.email}`} className="flex items-center gap-1 text-xs hover:underline">
                              <Mail className="h-3 w-3" />{buyer.email}
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-normal min-w-60">
                        {criteria ? (
                          <div>
                            {criteria.areas && (
                              <div>
                                <AreasLine areas={criteria.areas}>
                                  {criteria.geocodedAreas?.length > 0 ? (
                                    <Badge variant="outline" className="text-base text-green-600 border-green-300 align-[-2px]">
                                      On Map
                                    </Badge>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-5 text-base px-1.5 align-[-2px]"
                                      onClick={() => handleGeocodeAreas(buyer.id)}
                                    >
                                      <MapPin className="h-3 w-3 mr-1" />Map Areas
                                    </Button>
                                  )}
                                </AreasLine>
                              </div>
                            )}
                            {criteria.priceRange && <div>Price: {criteria.priceRange}</div>}
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-normal text-balance">{buyer.notes || "-"}</TableCell>
                      <TableCell>
                        <button onClick={() => handleDelete(buyer.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
