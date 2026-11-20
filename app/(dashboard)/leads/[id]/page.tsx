"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { LeadStatusSelect } from "@/components/leads/lead-status-badge";
import { TagBadge } from "@/components/tags/tag-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";
import { noteCheck } from "@/components/leads/quick-note-dialog";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Plus,
  Trash2,
  Save,
  StickyNote,
} from "lucide-react";

interface LeadTag {
  id: number;
  name: string;
  color: string;
}

interface Lead {
  id: number;
  firstName: string | null;
  lastName: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  source: string | null;
  customData: string | null;
  createdAt: string;
  updatedAt: string;
  tags: LeadTag[];
}

interface Note {
  id: number;
  leadId: number;
  content: string;
  createdAt: string;
}

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [allTags, setAllTags] = useState<LeadTag[]>([]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Lead>>({});
  // True after a refused load of the lead, until a load succeeds. Before the
  // lead is shown it replaces "Loading..." with a sentence.
  const [loadFailed, setLoadFailed] = useState(false);
  // True when the first load answered "not found": a refresh cannot help then.
  const [notFound, setNotFound] = useState(false);
  // True while "Try again" runs the load again.
  const [retrying, setRetrying] = useState(false);
  // True once a lead has been shown, so a later "not found" keeps the usual message.
  const leadShownRef = useRef(false);
  // True while a note is being saved. The ref blocks a second click at once.
  const [addingNote, setAddingNote] = useState(false);
  const addingNoteRef = useRef(false);

  // Loads the lead. On a refusal the lead already on the screen stays.
  // `quiet` is for the reload after a refused change: its message is already shown.
  const fetchLead = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      const res = await apiFetch(`/api/leads/${id}`);
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!data || typeof data !== "object") {
        // Not found before any lead is shown: the screen itself says so, no toast.
        if (res.status === 404 && !leadShownRef.current) {
          setNotFound(true);
          return;
        }
        setLoadFailed(true);
        if (!quiet) {
          // One id, so a second load at the same time does not stack a second toast.
          toast.error(
            res.ok
              ? "Could not load the lead. Something went wrong on our side. Try again in a minute."
              : await apiErrorMessage(res, "Could not load the lead"),
            { id: `lead-load-${id}` }
          );
        }
        return;
      }
      leadShownRef.current = true;
      setNotFound(false);
      setLoadFailed(false);
      setLead(data);
      setEditData(data);
    },
    [id]
  );

  // Quiet on a refusal: the notes already on the screen stay.
  const fetchNotes = useCallback(async () => {
    const res = await apiFetch(`/api/notes?leadId=${id}`);
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) setNotes(data);
  }, [id]);

  // Quiet on a refusal: the tags already on the screen stay.
  const fetchTags = useCallback(async () => {
    const res = await apiFetch("/api/tags");
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) setAllTags(data);
  }, []);

  useEffect(() => {
    fetchLead();
    fetchNotes();
    fetchTags();
  }, [fetchLead, fetchNotes, fetchTags]);

  const handleStatusChange = async (status: string) => {
    const res = await apiFetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    // Reload either way so the status shown is the one that was saved.
    // After a refusal the reload is quiet, so the message about the status is the one the user reads.
    fetchLead({ quiet: !res.ok });
    if (!res.ok) {
      toast.error(
        await apiErrorMessage(res, "Could not update the status", "Pick one of the statuses in the list.")
      );
      return;
    }
    toast.success("Status updated");
  };

  const handleSave = async () => {
    const res = await apiFetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: editData.firstName,
        lastName: editData.lastName,
        propertyAddress: editData.propertyAddress,
        propertyCity: editData.propertyCity,
        propertyState: editData.propertyState,
        propertyZip: editData.propertyZip,
        mailingAddress: editData.mailingAddress,
        mailingCity: editData.mailingCity,
        mailingState: editData.mailingState,
        mailingZip: editData.mailingZip,
        phone: editData.phone,
        email: editData.email,
      }),
    });
    // Keep the form open on a rejected save so the edits are not lost.
    if (!res.ok) {
      toast.error(
        await apiErrorMessage(
          res,
          "Could not save the lead",
          editData.propertyAddress?.trim()
            ? "Check that no field is too long."
            : "The property address is required."
        )
      );
      return;
    }
    setEditing(false);
    fetchLead();
    toast.success("Lead updated");
  };

  const handleAddNote = async () => {
    // A second click while the first note is saving would save it twice.
    if (!newNote.trim() || addingNoteRef.current) return;
    addingNoteRef.current = true;
    setAddingNote(true);
    try {
      const res = await apiFetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: Number(id), content: newNote, localNow: new Date().toLocaleString("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(" ", "T") }),
      });
      // On a refusal the typed note stays in the box.
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, "Could not add the note", noteCheck(newNote)));
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
      addingNoteRef.current = false;
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    const res = await apiFetch(`/api/notes?id=${noteId}`, { method: "DELETE" });
    // Reload either way so the list shows what is really saved.
    fetchNotes();
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not delete the note"));
    }
  };

  const handleAddTag = async (tagId: number) => {
    const res = await apiFetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addTag", tagId }),
    });
    fetchLead({ quiet: !res.ok });
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not add the tag"));
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    const res = await apiFetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeTag", tagId }),
    });
    fetchLead({ quiet: !res.ok });
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not remove the tag"));
    }
  };

  // Runs the first load again (not quiet, so a second refusal says so again).
  const handleRetry = async () => {
    setRetrying(true);
    try {
      await fetchLead();
    } finally {
      setRetrying(false);
    }
  };

  if (!lead) {
    if (notFound) {
      return (
        <div className="p-6 flex flex-wrap items-center gap-3">
          <span>This lead was not found. It may have been deleted.</span>
          <Button variant="outline" size="sm" onClick={() => router.push("/leads")}>
            Back to Leads
          </Button>
        </div>
      );
    }
    if (loadFailed) {
      return (
        <div className="p-6 flex flex-wrap items-center gap-3">
          <span>This lead could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
            Try again
          </Button>
        </div>
      );
    }
    return <div className="p-6">Loading...</div>;
  }

  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
  const availableTags = allTags.filter(
    (t) => !lead.tags.some((lt) => lt.id === t.id)
  );

  return (
    <div className="max-w-4xl">
      <Button
        variant="ghost"
        onClick={() => router.push("/leads")}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Leads
      </Button>

      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-muted-foreground flex items-center gap-1 text-sm">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="break-words">
              {lead.propertyAddress}
              {lead.propertyCity && `, ${lead.propertyCity}`}
              {lead.propertyState && `, ${lead.propertyState}`}
              {lead.propertyZip && ` ${lead.propertyZip}`}
            </span>
          </p>
        </div>
        <LeadStatusSelect
          status={lead.status}
          onStatusChange={handleStatusChange}
        />
      </div>

      {/* Quick contact */}
      <div className="flex flex-wrap gap-3 mb-6">
        {lead.phone && (
          <a href={`tel:${lead.phone}`}>
            <Button variant="outline" size="sm">
              <Phone className="h-4 w-4 mr-2" />
              {lead.phone}
            </Button>
          </a>
        )}
        {lead.email && (
          <a href={`mailto:${lead.email}`}>
            <Button variant="outline" size="sm">
              <Mail className="h-4 w-4 mr-2" />
              {lead.email}
            </Button>
          </a>
        )}
      </div>

      {/* Tags */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {lead.tags.map((tag) => (
          <TagBadge
            key={tag.id}
            name={tag.name}
            color={tag.color}
            onRemove={() => handleRemoveTag(tag.id)}
          />
        ))}
        {availableTags.length > 0 && (
          // Always empty (value null), so the same tag can be picked again after a refused add.
          <Select value={null} onValueChange={(v) => v && handleAddTag(Number(v))}>
            <SelectTrigger className="w-[140px] h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              <span>Add Tag</span>
            </SelectTrigger>
            <SelectContent>
              {availableTags.map((tag) => (
                <SelectItem key={tag.id} value={String(tag.id)}>
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Lead Details</CardTitle>
              {editing ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave}>
                    <Save className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setEditData(lead);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>First Name</Label>
                  {editing ? (
                    <Input
                      value={editData.firstName || ""}
                      onChange={(e) =>
                        setEditData({ ...editData, firstName: e.target.value })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.firstName || "-"}</p>
                  )}
                </div>
                <div>
                  <Label>Last Name</Label>
                  {editing ? (
                    <Input
                      value={editData.lastName || ""}
                      onChange={(e) =>
                        setEditData({ ...editData, lastName: e.target.value })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.lastName || "-"}</p>
                  )}
                </div>
                <div>
                  <Label>Phone</Label>
                  {editing ? (
                    <Input
                      value={editData.phone || ""}
                      onChange={(e) =>
                        setEditData({ ...editData, phone: e.target.value })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.phone || "-"}</p>
                  )}
                </div>
                <div>
                  <Label>Email</Label>
                  {editing ? (
                    <Input
                      value={editData.email || ""}
                      onChange={(e) =>
                        setEditData({ ...editData, email: e.target.value })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.email || "-"}</p>
                  )}
                </div>
              </div>

              <Separator className="my-4" />

              <h3 className="font-medium mb-3">Property Address</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Address</Label>
                  {editing ? (
                    <Input
                      value={editData.propertyAddress || ""}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          propertyAddress: e.target.value,
                        })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.propertyAddress}</p>
                  )}
                </div>
                <div>
                  <Label>City</Label>
                  {editing ? (
                    <Input
                      value={editData.propertyCity || ""}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          propertyCity: e.target.value,
                        })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.propertyCity || "-"}</p>
                  )}
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label>State</Label>
                    {editing ? (
                      <Input
                        value={editData.propertyState || ""}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            propertyState: e.target.value,
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm mt-1">
                        {lead.propertyState || "-"}
                      </p>
                    )}
                  </div>
                  <div className="flex-1">
                    <Label>Zip</Label>
                    {editing ? (
                      <Input
                        value={editData.propertyZip || ""}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            propertyZip: e.target.value,
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm mt-1">{lead.propertyZip || "-"}</p>
                    )}
                  </div>
                </div>
              </div>

              <Separator className="my-4" />

              <h3 className="font-medium mb-3">Mailing Address</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Address</Label>
                  {editing ? (
                    <Input
                      value={editData.mailingAddress || ""}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          mailingAddress: e.target.value,
                        })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">
                      {lead.mailingAddress || "-"}
                    </p>
                  )}
                </div>
                <div>
                  <Label>City</Label>
                  {editing ? (
                    <Input
                      value={editData.mailingCity || ""}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          mailingCity: e.target.value,
                        })
                      }
                    />
                  ) : (
                    <p className="text-sm mt-1">{lead.mailingCity || "-"}</p>
                  )}
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label>State</Label>
                    {editing ? (
                      <Input
                        value={editData.mailingState || ""}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            mailingState: e.target.value,
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm mt-1">
                        {lead.mailingState || "-"}
                      </p>
                    )}
                  </div>
                  <div className="flex-1">
                    <Label>Zip</Label>
                    {editing ? (
                      <Input
                        value={editData.mailingZip || ""}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            mailingZip: e.target.value,
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm mt-1">{lead.mailingZip || "-"}</p>
                    )}
                  </div>
                </div>
              </div>

              {lead.source && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <Label>Source</Label>
                    <p className="text-sm mt-1 text-muted-foreground">
                      {lead.source}
                    </p>
                  </div>
                </>
              )}

              {lead.customData && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <Label>Additional Data</Label>
                    <pre className="text-xs mt-1 p-2 bg-muted rounded">
                      {JSON.stringify(JSON.parse(lead.customData), null, 2)}
                    </pre>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StickyNote className="h-5 w-5" />
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Textarea
                  placeholder="Add a note..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
              <Button
                onClick={handleAddNote}
                disabled={!newNote.trim() || addingNote}
                className="mb-6"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Note
              </Button>

              <div className="space-y-3">
                {notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No notes yet
                  </p>
                ) : (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      className="border rounded-md p-3 group"
                    >
                      <div className="flex items-start justify-between">
                        <p className="text-sm whitespace-pre-wrap">
                          {note.content}
                        </p>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(note.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 shrink-0" />
                    <div>
                      <p className="text-sm">Note added</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {note.content.substring(0, 100)}
                        {note.content.length > 100 ? "..." : ""}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(note.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
                <div className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0" />
                  <div>
                    <p className="text-sm">Lead created</p>
                    {lead.source && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Imported from {lead.source}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(lead.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
