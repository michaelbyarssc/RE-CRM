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
  return (
    <Select value={status} onValueChange={(v) => v && onStatusChange(v)}>
      <SelectTrigger className="w-[140px] h-8 text-xs">
        <SelectValue />
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
