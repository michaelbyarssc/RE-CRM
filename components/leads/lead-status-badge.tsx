"use client";

import { Badge } from "@/components/ui/badge";
import { STATUS_MAP, LEAD_STATUSES, type LeadStatus } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LeadStatusBadge({ status }: { status: string }) {
  const info = STATUS_MAP[status as LeadStatus];
  if (!info) return <Badge variant="outline">{status}</Badge>;

  return (
    <Badge
      variant="outline"
      className={`${info.color} text-white border-transparent`}
    >
      {info.label}
    </Badge>
  );
}

export function LeadStatusSelect({
  status,
  onStatusChange,
}: {
  status: string;
  onStatusChange: (status: string) => void;
}) {
  const currentStatus = LEAD_STATUSES.find((s) => s.value === status);
  return (
    <Select value={status} onValueChange={(v) => v && onStatusChange(v)}>
      <SelectTrigger className="h-8 text-xs">
        {/* Every label sits invisibly in the same spot, so the box is always as
            wide as the longest label in whatever font loads, and every status
            box has the same width. The shown label is laid over them, so an
            unknown status value cannot widen the box; it gets three dots instead. */}
        <span className="relative grid">
          {LEAD_STATUSES.map((s) => (
            <span
              key={s.value}
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full" />
              {s.label}
            </span>
          ))}
          <span className="absolute inset-0 flex min-w-0 items-center gap-2">
            <span
              className={`w-2 h-2 shrink-0 rounded-full ${currentStatus?.color ?? "bg-muted-foreground"}`}
            />
            <span
              className="min-w-0 truncate"
              title={currentStatus ? undefined : status}
            >
              {currentStatus?.label ?? status}
            </span>
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {LEAD_STATUSES.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${s.color}`} />
              {s.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
