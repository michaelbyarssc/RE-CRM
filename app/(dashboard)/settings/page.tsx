"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Settings, Eye, EyeOff, Save, Search, Phone, CalendarDays, Check, X, RefreshCw, Loader2, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
}

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
      { key: "twilio_phone_number", label: "Phone Number", placeholder: "+1234567890" },
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
  const [values, setValues] = useState<Record<string, string>>({});
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
        setValues(data);
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

    // Check for OAuth redirect params
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_success")) {
      toast.success("Google Calendar connected!");
      window.history.replaceState({}, "", "/settings");
      fetchGoogleStatus();
    }
    if (params.get("google_error")) {
      toast.error(`Google Calendar error: ${params.get("google_error")}`);
      window.history.replaceState({}, "", "/settings");
    }
  }, [fetchSettings, fetchGoogleStatus]);

  const toggleVisibility = (key: string) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (section: SectionConfig) => {
    setSaving((prev) => ({ ...prev, [section.id]: true }));
    try {
      const payload: Record<string, string> = {};
      for (const field of section.fields) {
        payload[field.key] = values[field.key] || "";
      }
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(`${section.title} saved successfully`);
      } else {
        toast.error("Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving((prev) => ({ ...prev, [section.id]: false }));
    }
  };

  const handleGoogleConnect = () => {
    window.location.href = "/api/calendar/google?action=connect";
  };

  const handleGoogleDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar? Events already in the CRM will be kept.")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/calendar/google", { method: "DELETE" });
      toast.success("Google Calendar disconnected");
      setGoogleStatus({ connected: false, calendarId: null, syncEnabled: false, lastSyncAt: null });
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleGoogleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/calendar/google/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Synced! Pushed: ${data.pushed}, Pulled: ${data.pulled}${data.errors ? `, Errors: ${data.errors}` : ""}`);
        fetchGoogleStatus();
      } else {
        toast.error(data.error || "Sync failed");
      }
    } catch {
      toast.error("Sync failed");
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
                {section.fields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <div className="relative">
                      <Input
                        id={field.key}
                        type={visibility[field.key] ? "text" : "password"}
                        value={values[field.key] || ""}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => toggleVisibility(field.key)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {visibility[field.key] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
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
