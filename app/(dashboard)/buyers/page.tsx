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
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";
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

  // Asks the server to look up a buyer's areas and put them on the map, then
  // tells the user what happened. The server looks up at most 25 areas per
  // buyer, always the first 25, and answers how many it left out (`skipped`).
  const mapBuyerAreas = async (buyerId: number, isNewBuyer: boolean) => {
    const res = await apiFetch("/api/buyers/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyerId }),
    });
    if (!res.ok) {
      if (isNewBuyer) {
        toast.error(
          await apiErrorMessage(res, "The buyer was added, but the areas were not put on the map", "Refresh the page and try again."),
          { description: 'Press "Map Areas" next to the buyer to try again. Do not add the buyer again.' }
        );
      } else {
        toast.error(
          await apiErrorMessage(res, "Could not put this buyer's areas on the map", "Refresh the page and try again.")
        );
      }
      fetchBuyers();
      return;
    }

    const data: { geocoded?: number; total?: number; skipped?: number } =
      await res.json().catch(() => ({}));
    const geocoded = data.geocoded ?? 0;
    const total = data.total ?? 0;
    const skipped = data.skipped ?? 0;
    const lookedUp = total - skipped;

    if (total === 0) {
      toast.info("This buyer has no areas to put on the map.");
    } else if (geocoded > 0) {
      const notFound = lookedUp - geocoded;
      toast.success(
        `Mapped ${geocoded} area${geocoded > 1 ? "s" : ""} to the map` +
          (notFound > 0 ? `. ${notFound} could not be found.` : "")
      );
    } else {
      toast.error("Could not find any of these areas on the map. Check the spelling of the zip codes, cities and counties.");
    }

    if (skipped > 0) {
      toast.warning(
        `${skipped} of ${total} areas were left out of the map`,
        {
          description:
            `The map takes only the first 25 areas of each buyer, so ${lookedUp} were looked up. ` +
            "Mapping this buyer again looks up the same 25. To map the others, add them as a separate buyer.",
          duration: Infinity,
          closeButton: true,
        }
      );
    }
    fetchBuyers();
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/buyers", {
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
      if (!res.ok) {
        // Keep the dialog open with everything the user typed.
        toast.error(
          await apiErrorMessage(
            res,
            "Could not add the buyer",
            "Check that no field is too long: name, company and price range up to 200 characters, phone up to 50, areas and notes up to 5,000."
          )
        );
        return;
      }
      const buyer: Buyer = await res.json();

      // The buyer is saved. Close the dialog and clear the form now, so that
      // pressing Add Buyer again cannot make a second copy of this buyer.
      setOpen(false);
      setForm({ name: "", company: "", phone: "", email: "", areas: "", priceRange: "", notes: "" });
      fetchBuyers();

      // Put the buyer's areas on the map. This can take up to about 30
      // seconds, so it runs on after the dialog has closed and reports back
      // with its own message.
      if (form.areas.trim()) {
        toast.success("Buyer added! Geocoding areas for map...");
        void mapBuyerAreas(buyer.id, true);
      } else {
        toast.success("Buyer added");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this buyer?")) return;
    const res = await apiFetch(`/api/buyers?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not remove the buyer", "Refresh the page and try again."));
      fetchBuyers();
      return;
    }
    toast.success("Buyer removed");
    fetchBuyers();
  };

  const handleGeocodeAreas = async (buyerId: number) => {
    toast.info("Geocoding areas for map...");
    await mapBuyerAreas(buyerId, false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Buyers List</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />
            Add Buyer
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
        <>
          {/* Mobile card view */}
          <div className="md:hidden space-y-3">
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <MapPin className="h-3.5 w-3.5" />
                            <span>Areas: {criteria.areas}</span>
                            {criteria.geocodedAreas?.length > 0 ? (
                              <Badge variant="outline" className="text-base text-green-600 border-green-300">
                                On Map
                              </Badge>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 text-base px-1.5"
                                onClick={(e) => { e.stopPropagation(); handleGeocodeAreas(buyer.id); }}
                              >
                                <MapPin className="h-3 w-3 mr-1" />Map Areas
                              </Button>
                            )}
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

          {/* Desktop table view */}
          <div className="hidden md:block border rounded-md">
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
                      <TableCell>{buyer.company || "-"}</TableCell>
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
                      <TableCell className="text-sm">
                        {criteria ? (
                          <div>
                            {criteria.areas && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>Areas: {criteria.areas}</span>
                                {criteria.geocodedAreas?.length > 0 ? (
                                  <Badge variant="outline" className="text-base text-green-600 border-green-300">
                                    On Map
                                  </Badge>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-5 text-base px-1.5"
                                    onClick={() => handleGeocodeAreas(buyer.id)}
                                  >
                                    <MapPin className="h-3 w-3 mr-1" />Map Areas
                                  </Button>
                                )}
                              </div>
                            )}
                            {criteria.priceRange && <div>Price: {criteria.priceRange}</div>}
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{buyer.notes || "-"}</TableCell>
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
        </>
      )}
    </div>
  );
}
