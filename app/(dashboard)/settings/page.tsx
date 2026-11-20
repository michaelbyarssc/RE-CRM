"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";
import { Settings, Eye, EyeOff, Save, Search, Phone, CalendarDays, Check, RefreshCw, Loader2, Unlink, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
  // A public field shows its saved value. Every other field is a secret: the
  // server only says whether it is saved and its last 4 characters.
  isPublic?: boolean;
}

interface SecretStatus {
  set: boolean;
  last4: string | null;
  unreadable?: boolean;
}

const REPLACE_PLACEHOLDER = "Enter a new value to replace it";

interface SectionConfig {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  fields: FieldConfig[];
}

const sections: SectionConfig[] = [
  {
    id: "skip-trace",
    title: "Skip Trace API Keys",
    description: "Connect your skip trace providers to look up owner contact info directly from the CRM.",
    icon: <Search className="h-5 w-5" />,
    fields: [
      { key: "reiskip_api_key", label: "REISkip API Key", placeholder: "Enter your REISkip API key" },
      { key: "batchskiptracing_api_key", label: "BatchSkipTracing API Key", placeholder: "Enter your BatchSkipTracing API key" },
      { key: "skipengine_api_key", label: "SkipEngine API Key", placeholder: "Enter your SkipEngine API key" },
    ],
  },
  {
    id: "twilio",
    title: "Twilio (Dialer / SMS)",
    description: "Configure Twilio credentials for the power dialer and SMS sequences.",
    icon: <Phone className="h-5 w-5" />,
    fields: [
      { key: "twilio_account_sid", label: "Account SID", placeholder: "Enter your Twilio Account SID" },
      { key: "twilio_auth_token", label: "Auth Token", placeholder: "Enter your Twilio Auth Token" },
      { key: "twilio_phone_number", label: "Phone Number", placeholder: "+1234567890", isPublic: true },
    ],
  },
];

interface GoogleCalStatus {
  connected: boolean;
  calendarId: string | null;
  syncEnabled: boolean;
  lastSyncAt: string | null;
}

export default function SettingsPage() {
  // What the server has: public values, and only the status of each secret.
  const [publicValues, setPublicValues] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, SecretStatus>>({});
  // Only what the user typed. A key is here only if the user changed that field.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleCalStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setPublicValues(data && typeof data.values === "object" && data.values ? data.values : {});
        setSecrets(data && typeof data.secrets === "object" && data.secrets ? data.secrets : {});
      }
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoaded(true);
    }
  }, []);

  const fetchGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/google");
      if (res.ok) setGoogleStatus(await res.json());
    } catch {
      // Not configured yet
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchGoogleStatus();

    // Check for OAuth redirect params. This runs one tick later: the page's
    // effect runs before the app-wide Toaster starts listening, so a toast
    // shown right away was lost.
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("google_success")) {
        toast.success("Google Calendar connected!");
        window.history.replaceState({}, "", "/settings");
        fetchGoogleStatus();
      }
      if (params.get("google_error") === "invalid_state") {
        toast.error("Google Calendar was not connected: the sign-in link was old or not started here. Please click Connect again.");
        window.history.replaceState({}, "", "/settings");
      } else if (params.get("google_error") === "encryption_not_configured") {
        toast.error("Google Calendar was not connected: the site is missing a security setting. Please tell the site owner.");
        window.history.replaceState({}, "", "/settings");
      } else if (params.get("google_error")) {
        // The address can be crafted: show only a short code, never free text.
        const code = params.get("google_error") ?? "";
        toast.error(/^[a-z_]{1,64}$/.test(code) ? `Google Calendar error: ${code}` : "Google Calendar error");
        window.history.replaceState({}, "", "/settings");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchSettings, fetchGoogleStatus]);

  const toggleVisibility = (key: string) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleChange = (key: string, value: string) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const clearEdits = (keys: string[]) => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const handleSave = async (section: SectionConfig) => {
    // Send only the fields the user typed into. For a secret, an empty value
    // would mean "keep what is saved", so there is no point in sending it.
    const payload: Record<string, string> = {};
    for (const field of section.fields) {
      if (!(field.key in edits)) continue;
      const value = edits[field.key];
      if (!field.isPublic && !value.trim()) continue;
      payload[field.key] = value;
    }
    if (Object.keys(payload).length === 0) {
      toast.info("Nothing to save. Type a new value first.");
      return;
    }
    // The server skips a value over 10,000 characters (a secret measured after
    // trimming), so refuse it here: never say "saved" for a skipped value.
    for (const field of section.fields) {
      if (!(field.key in payload)) continue;
      const length = field.isPublic ? payload[field.key].length : payload[field.key].trim().length;
      if (length > 10_000) {
        toast.error(`${field.label} is too long (10,000 characters at most). Nothing was saved.`);
        return;
      }
    }

    setSaving((prev) => ({ ...prev, [section.id]: true }));
    try {
      const res = await apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Nothing was saved. The typed values stay in the fields; the server's
        // own text (for example a missing encryption setting) is shown when it sends one.
        toast.error(await apiErrorMessage(res, `Could not save ${section.title}`));
        return;
      }
      toast.success(`${section.title} saved successfully`);
      // Forget what was typed and show the saved status from the server.
      clearEdits(section.fields.map((f) => f.key));
      await fetchSettings();
    } finally {
      setSaving((prev) => ({ ...prev, [section.id]: false }));
    }
  };

  const handleRemove = async (field: FieldConfig) => {
    if (!confirm(`Remove the saved ${field.label}? The CRM will stop using it until you enter it again.`)) return;
    setRemoving((prev) => ({ ...prev, [field.key]: true }));
    try {
      const res = await apiFetch(`/api/settings?key=${encodeURIComponent(field.key)}`, { method: "DELETE" });
      if (!res.ok) {
        // The key stays saved and is still shown as saved.
        toast.error(await apiErrorMessage(res, `Could not remove ${field.label}`, "Refresh the page and try again."));
        return;
      }
      toast.success(`${field.label} removed`);
      clearEdits([field.key]);
      await fetchSettings();
    } finally {
      setRemoving((prev) => ({ ...prev, [field.key]: false }));
    }
  };

  const handleGoogleConnect = () => {
    window.location.href = "/api/calendar/google?action=connect";
  };

  const handleGoogleDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar? Events already in the CRM will be kept.")) return;
    setDisconnecting(true);
    try {
      const res = await apiFetch("/api/calendar/google", { method: "DELETE" });
      if (!res.ok) {
        // Still connected as far as we know: show what the server has now.
        toast.error(await apiErrorMessage(res, "Could not disconnect Google Calendar", "Refresh the page and try again."));
        await fetchGoogleStatus();
        return;
      }
      toast.success("Google Calendar disconnected");
      setGoogleStatus({ connected: false, calendarId: null, syncEnabled: false, lastSyncAt: null });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleGoogleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch("/api/calendar/google/sync", { method: "POST" });
      if (!res.ok) {
        toast.error(
          await apiErrorMessage(res, "Could not sync with Google Calendar", "Check that Google Calendar is still connected, then try again.")
        );
        await fetchGoogleStatus();
        return;
      }
      // The sync is done; the counts are only shown when the answer can be read.
      const data = await res.json().catch(() => null);
      toast.success(
        data ? `Synced! Pushed: ${data.pushed}, Pulled: ${data.pulled}${data.errors ? `, Errors: ${data.errors}` : ""}` : "Synced!"
      );
      await fetchGoogleStatus();
    } finally {
      setSyncing(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage API keys and integrations for your CRM
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Google Calendar Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg flex items-center gap-2">
                  Google Calendar
                  {googleStatus?.connected && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                      <Check className="h-3 w-3 mr-1" /> Connected
                    </Badge>
                  )}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Two-way sync your calendar events with Google Calendar
                </p>
              </div>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-6">
            {googleStatus?.connected ? (
              <div className="space-y-4">
                <div className="text-sm space-y-1">
                  <p>
                    <span className="text-muted-foreground">Calendar:</span>{" "}
                    {googleStatus.calendarId || "Primary"}
                  </p>
                  {googleStatus.lastSyncAt && (
                    <p>
                      <span className="text-muted-foreground">Last synced:</span>{" "}
                      {new Date(googleStatus.lastSyncAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleGoogleSync} disabled={syncing} size="sm">
                    {syncing ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing...</>
                    ) : (
                      <><RefreshCw className="h-4 w-4 mr-2" />Sync Now</>
                    )}
                  </Button>
                  <Button
                    onClick={handleGoogleDisconnect}
                    disabled={disconnecting}
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    <Unlink className="h-4 w-4 mr-2" />
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Connect your Google Calendar to automatically sync appointments,
                  callbacks, and follow-ups between Deal Desk Pro and Google Calendar.
                </p>
                <Button onClick={handleGoogleConnect}>
                  <CalendarDays className="h-4 w-4 mr-2" />
                  Connect Google Calendar
                </Button>
                <p className="text-xs text-muted-foreground">
                  Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables to be set.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {sections.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary">
                  {section.icon}
                </div>
                <div>
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {section.description}
                  </p>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-6">
              <div className="space-y-4">
                {section.fields.map((field) => {
                  const status = field.isPublic ? undefined : secrets[field.key];
                  const saved = !!status?.set;
                  const statusId = `${field.key}-status`;
                  const value = field.isPublic
                    ? (field.key in edits ? edits[field.key] : publicValues[field.key] ?? "")
                    : edits[field.key] ?? "";
                  return (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={field.key}>{field.label}</Label>
                      <div className="relative">
                        <Input
                          id={field.key}
                          type={visibility[field.key] ? "text" : "password"}
                          value={value}
                          onChange={(e) => handleChange(field.key, e.target.value)}
                          placeholder={saved ? REPLACE_PLACEHOLDER : field.placeholder}
                          aria-describedby={saved ? statusId : undefined}
                          // Stop the browser or a password manager from filling a
                          // login password into an empty key field.
                          autoComplete={field.isPublic ? "off" : "new-password"}
                          {...(field.isPublic
                            ? {}
                            : {
                                "data-1p-ignore": "",
                                "data-lpignore": "true",
                                "data-bwignore": "",
                                "data-form-type": "other",
                              })}
                          spellCheck={false}
                          autoCapitalize="none"
                          autoCorrect="off"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => toggleVisibility(field.key)}
                          aria-label={visibility[field.key] ? `Hide ${field.label}` : `Show ${field.label}`}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {visibility[field.key] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {saved && (
                        <div className="flex items-start justify-between gap-3">
                          <p
                            id={statusId}
                            className={`flex items-start gap-1.5 text-xs ${status?.unreadable ? "text-destructive" : "text-muted-foreground"}`}
                          >
                            {status?.unreadable ? (
                              <TriangleAlert className="h-3.5 w-3.5 mt-px shrink-0" />
                            ) : (
                              <Check className="h-3.5 w-3.5 mt-px shrink-0 text-green-600" />
                            )}
                            <span>
                              {status?.unreadable
                                ? "Saved, but it can no longer be read. Enter it again."
                                : status?.last4
                                  ? `Saved, ends in ${status.last4}`
                                  : "Saved"}
                            </span>
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => handleRemove(field)}
                            disabled={removing[field.key]}
                            aria-label={`Remove the saved ${field.label}`}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 />
                            {removing[field.key] ? "Removing..." : "Remove"}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="pt-2">
                  <Button
                    onClick={() => handleSave(section)}
                    disabled={saving[section.id]}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saving[section.id] ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
