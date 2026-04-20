"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Settings, Eye, EyeOff, Save, Search, Phone } from "lucide-react";

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

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

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

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

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
