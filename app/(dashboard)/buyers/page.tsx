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
import { Plus, Trash2, Phone, Mail, UserCheck } from "lucide-react";

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

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    await fetch("/api/buyers", {
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
    toast.success("Buyer added");
    setOpen(false);
    setForm({ name: "", company: "", phone: "", email: "", areas: "", priceRange: "", notes: "" });
    fetchBuyers();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this buyer?")) return;
    await fetch(`/api/buyers?id=${id}`, { method: "DELETE" });
    toast.success("Buyer removed");
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Areas / Zip Codes</Label>
                  <Input value={form.areas} onChange={(e) => setForm({ ...form, areas: e.target.value })} placeholder="e.g. 77001, Houston" />
                </div>
                <div>
                  <Label>Price Range</Label>
                  <Input value={form.priceRange} onChange={(e) => setForm({ ...form, priceRange: e.target.value })} placeholder="e.g. $50k-$150k" />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Property types, preferences..." />
              </div>
              <Button onClick={handleCreate} disabled={!form.name.trim()}>Add Buyer</Button>
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
        <div className="border rounded-md">
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
                          {criteria.areas && <div>Areas: {criteria.areas}</div>}
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
      )}
    </div>
  );
}
