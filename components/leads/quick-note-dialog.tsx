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
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";

/** The longest note the server accepts (app/api/notes/route.ts, MAX_NOTE_LENGTH). */
const MAX_NOTE_LENGTH = 10_000;

/** The hint shown when the server refuses a note: names the length limit when the note is over it. */
export function noteCheck(content: string): string | undefined {
  if (content.length <= MAX_NOTE_LENGTH) return undefined;
  return `The note is ${content.length.toLocaleString("en-US")} characters long. A note can be at most ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters.`;
}

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

  // Loads the notes. On a refusal the notes already on the screen stay.
  // `quiet` is for the reload after a refused delete: its message is already shown.
  const fetchNotes = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const res = await apiFetch(`/api/notes?leadId=${leadId}`);
    if (!res.ok) {
      if (!quiet) toast.error(await apiErrorMessage(res, "Could not load the notes"));
      return;
    }
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) setNotes(data);
  };

  useEffect(() => {
    if (open) {
      fetchNotes();
    }
  }, [open, leadId]);

  const handleAddNote = async () => {
    const content = newNote.trim();
    if (!content) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, content, localNow: new Date().toLocaleString("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(" ", "T") }),
      });
      // On a refusal the dialog stays open and the typed note stays in the box.
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, "Could not add the note", noteCheck(content)));
        return;
      }
      const data = await res.json().catch(() => ({}));
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
            description: `${data.calendarEvent.title} on ${eventDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${eventDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
            action: {
              label: "View Calendar",
              onClick: () => window.location.href = "/calendar",
            },
          }
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    const res = await apiFetch(`/api/notes?id=${noteId}`, { method: "DELETE" });
    // Reload either way so the list shows what is really saved.
    // After a refusal the reload is quiet, so the message about the delete is the one the user reads.
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not delete the note"));
      fetchNotes({ quiet: true });
      return;
    }
    fetchNotes();
    toast.success("Note deleted");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Notes" />}
      >
        <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Notes: {leadName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Add note. The box grows with the text up to 15rem, then scrolls on its own,
              so the Add Note button below it stays in view with a very long note. */}
          <div className="flex gap-2">
            <Textarea
              placeholder="Add a note..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-[60px] max-h-60 overflow-y-auto"
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
            <p className="text-base text-muted-foreground flex items-center gap-1">
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
