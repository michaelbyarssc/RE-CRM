"use client";

import { useState, useEffect, useCallback, use } from "react";
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

  const fetchLead = useCallback(async () => {
    const res = await fetch(`/api/leads/${id}`);
    if (res.ok) {
      const data = await res.json();
      setLead(data);
      setEditData(data);
    }
  }, [id]);

  const fetchNotes = useCallback(async () => {
    const res = await fetch(`/api/notes?leadId=${id}`);
    if (res.ok) setNotes(await res.json());
  }, [id]);

  const fetchTags = useCallback(async () => {
    const res = await fetch("/api/tags");
    if (res.ok) setAllTags(await res.json());
  }, []);

  useEffect(() => {
    fetchLead();
    fetchNotes();
    fetchTags();
  }, [fetchLead, fetchNotes, fetchTags]);

  const handleStatusChange = async (status: string) => {
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchLead();
    toast.success("Status updated");
  };

  const handleSave = async () => {
    await fetch(`/api/leads/${id}`, {
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
    setEditing(false);
    fetchLead();
    toast.success("Lead updated");
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: Number(id), content: newNote, timezoneOffset: new Date().getTimezoneOffset() }),
    });
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
  };

  const handleDeleteNote = async (noteId: number) => {
    await fetch(`/api/notes?id=${noteId}`, { method: "DELETE" });
    fetchNotes();
  };

  const handleAddTag = async (tagId: number) => {
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addTag", tagId }),
    });
    fetchLead();
  };

  const handleRemoveTag = async (tagId: number) => {
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeTag", tagId }),
    });
    fetchLead();
  };

  if (!lead) {
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
          <Select onValueChange={(v) => handleAddTag(Number(v))}>
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
                disabled={!newNote.trim()}
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
