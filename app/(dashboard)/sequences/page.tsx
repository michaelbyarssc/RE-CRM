"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";
import { Plus, ListOrdered, Users, Trash2 } from "lucide-react";

interface Sequence {
  id: number;
  name: string;
  description: string | null;
  isActive: number;
  createdAt: string;
  steps: { id: number; stepOrder: number; delayDays: number; actionType: string; template: string | null }[];
  enrolledCount: number;
}

export default function SequencesPage() {
  const router = useRouter();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  // True after the background run failed, so the user is told once, not every minute.
  const processFailedRef = useRef(false);

  const fetchSequences = useCallback(async () => {
    const res = await fetch("/api/sequences");
    if (res.ok) setSequences(await res.json());
  }, []);

  useEffect(() => {
    fetchSequences();
  }, [fetchSequences]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        // Keep the dialog open with the name and description the user typed.
        toast.error(
          await apiErrorMessage(
            res,
            "Could not create the sequence",
            "Keep the name to 200 characters and the description to 2,000 characters or fewer."
          )
        );
        return;
      }
      const seq = await res.json();
      toast.success("Sequence created");
      setOpen(false);
      setName("");
      setDescription("");
      router.push(`/sequences/${seq.id}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this sequence?")) return;
    const res = await apiFetch(`/api/sequences/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not delete the sequence"));
      return;
    }
    toast.success("Sequence deleted");
    fetchSequences();
  };

  // Process sequences periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await apiFetch("/api/sequences/process", { method: "POST" });
      if (!res.ok) {
        if (!processFailedRef.current) {
          processFailedRef.current = true;
          toast.error(await apiErrorMessage(res, "Could not run the follow-up steps that are due"));
        }
        return;
      }
      processFailedRef.current = false;
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Follow-up Sequences</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />
            New Sequence
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Sequence</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. 7-Day Follow Up"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe this sequence..."
                />
              </div>
              <Button onClick={handleCreate} disabled={creating || !name.trim()}>
                Create Sequence
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sequences.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <ListOrdered className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">No sequences yet</p>
            <p className="text-sm text-muted-foreground">
              Create a follow-up sequence to automate your outreach
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sequences.map((seq) => (
            <Card key={seq.id} className="cursor-pointer hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle
                    className="text-lg cursor-pointer hover:underline"
                    onClick={() => router.push(`/sequences/${seq.id}`)}
                  >
                    {seq.name}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={seq.isActive ? "default" : "secondary"}>
                      {seq.isActive ? "Active" : "Paused"}
                    </Badge>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(seq.id); }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {seq.description && (
                  <p className="text-sm text-muted-foreground mb-2">{seq.description}</p>
                )}
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{seq.steps.length} steps</span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {seq.enrolledCount} enrolled
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
