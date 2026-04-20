"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageSquarePlus, StickyNote, Trash2, CalendarDays } from "lucide-react";

interface Note {
  id: number;
  content: string;
  createdAt: string;
}

export function QuickNoteDialog({
  leadId,
  leadName,
}: {
  leadId: number;
  leadName: string;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchNotes = async () => {
    const res = await fetch(`/api/notes?leadId=${leadId}`);
    if (res.ok) {
      const data = await res.json();
      setNotes(data);
    }
  };

  useEffect(() => {
    if (open) {
      fetchNotes();
    }
  }, [open, leadId]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, content: newNote.trim(), localNow: new Date().toLocaleString("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(" ", "T") }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewNote("");
        fetchNotes();
        toast.success("Note added");
        // Show calendar event toast if auto-created
        if (data.calendarEvent) {
          const eventDate = new Date(data.calendarEvent.startAt);
          const typeLabel = data.calendarEvent.eventType === "callback" ? "Callback" :
            data.calendarEvent.eventType === "appointment" ? "Appointment" : "Follow-up";
          toast(
            `📅 ${typeLabel} scheduled`,
            {
              description: `${data.calendarEvent.title} — ${eventDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${eventDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
              action: {
                label: "View Calendar",
                onClick: () => window.location.href = "/calendar",
              },
            }
          );
        }
      }
    } catch {
      toast.error("Failed to add note");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    const res = await fetch(`/api/notes?id=${noteId}`, { method: "DELETE" });
    if (res.ok) {
      fetchNotes();
      toast.success("Note deleted");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Notes">
          <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Notes — {leadName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Add note */}
          <div className="flex gap-2">
            <Textarea
              placeholder="Add a note..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-[60px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleAddNote();
                }
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={!newNote.trim() || loading}
            >
              <MessageSquarePlus className="h-4 w-4 mr-1" />
              {loading ? "Adding..." : "Add Note"}
            </Button>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              Dates & times auto-add to calendar
            </p>
          </div>

          {/* Notes list */}
          {notes.length > 0 && (
            <div className="border-t pt-3 space-y-2 max-h-[300px] overflow-y-auto">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="bg-muted/50 rounded-md p-3 text-sm group relative"
                >
                  <p className="whitespace-pre-wrap pr-6">{note.content}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(note.createdAt).toLocaleString()}
                  </p>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {notes.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No notes yet
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
