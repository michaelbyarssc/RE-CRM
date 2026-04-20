"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Clock, Phone, Mail, MessageSquare, CheckSquare } from "lucide-react";

interface Step {
  id: number;
  stepOrder: number;
  delayDays: number;
  actionType: string;
  template: string | null;
}

interface Sequence {
  id: number;
  name: string;
  description: string | null;
  isActive: number;
  steps: Step[];
}

const ACTION_TYPES = [
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "sms", label: "SMS", icon: MessageSquare },
  { value: "task", label: "Task", icon: CheckSquare },
];

export default function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [newStep, setNewStep] = useState({
    delayDays: 1,
    actionType: "call",
    template: "",
  });

  const fetchSequence = useCallback(async () => {
    const res = await fetch(`/api/sequences/${id}`);
    if (res.ok) setSequence(await res.json());
  }, [id]);

  useEffect(() => {
    fetchSequence();
  }, [fetchSequence]);

  const handleAddStep = async () => {
    const stepOrder = (sequence?.steps.length ?? 0) + 1;
    await fetch(`/api/sequences/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "addStep",
        step: { ...newStep, stepOrder },
      }),
    });
    setNewStep({ delayDays: 1, actionType: "call", template: "" });
    fetchSequence();
    toast.success("Step added");
  };

  const handleDeleteStep = async (stepId: number) => {
    await fetch(`/api/sequences/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteStep", stepId }),
    });
    fetchSequence();
    toast.success("Step removed");
  };

  if (!sequence) return <div>Loading...</div>;

  return (
    <div className="max-w-3xl">
      <Button variant="ghost" onClick={() => router.push("/sequences")} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Sequences
      </Button>

      <h1 className="text-2xl font-bold mb-1">{sequence.name}</h1>
      {sequence.description && (
        <p className="text-muted-foreground mb-6">{sequence.description}</p>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Steps ({sequence.steps.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {sequence.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No steps yet. Add your first step below.
            </p>
          ) : (
            <div className="space-y-3">
              {sequence.steps.map((step, i) => {
                const actionInfo = ACTION_TYPES.find((a) => a.value === step.actionType);
                const Icon = actionInfo?.icon || CheckSquare;
                return (
                  <div key={step.id} className="flex items-start gap-3 p-3 border rounded-md">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                        {i + 1}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm capitalize">
                          {step.actionType}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {step.delayDays} day{step.delayDays !== 1 ? "s" : ""} after{" "}
                          {i === 0 ? "enrollment" : "previous step"}
                        </span>
                      </div>
                      {step.template && (
                        <p className="text-sm text-muted-foreground">{step.template}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteStep(step.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add Step</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Action Type</Label>
              <Select
                value={newStep.actionType}
                onValueChange={(v) => v && setNewStep({ ...newStep, actionType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Delay (days)</Label>
              <Input
                type="number"
                min={0}
                value={newStep.delayDays}
                onChange={(e) =>
                  setNewStep({ ...newStep, delayDays: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div>
            <Label>Template / Instructions</Label>
            <Textarea
              value={newStep.template}
              onChange={(e) => setNewStep({ ...newStep, template: e.target.value })}
              placeholder="e.g. Call {{first_name}} about {{property_address}}. Ask about motivation to sell."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Available variables: {"{{first_name}}"}, {"{{last_name}}"}, {"{{property_address}}"}, {"{{phone}}"}
            </p>
          </div>
          <Button onClick={handleAddStep}>
            <Plus className="h-4 w-4 mr-2" />
            Add Step
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
