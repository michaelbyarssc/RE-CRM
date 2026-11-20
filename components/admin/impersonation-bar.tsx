"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Users } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";

interface UserInfo {
  id: string;
  effectiveId: string;
  email: string;
  role: "user" | "admin";
  isImpersonating: boolean;
  impersonatingEmail: string | null;
}

interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
}

export function ImpersonationBar() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Quiet on a refusal: the bar is only for admins, so it just stays hidden.
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.role) setUserInfo(data);
      })
      .catch(() => {});
  }, []);

  // Only render for admins
  if (!userInfo || userInfo.role !== "admin") return null;

  const loadUsers = async () => {
    if (users.length > 0) {
      setShowPicker(!showPicker);
      return;
    }
    const res = await apiFetch("/api/admin/impersonate");
    // On a refusal the list stays as it was (closed) and the admin sees why.
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not load the user list"));
      return;
    }
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) {
      toast.error("Could not load the user list. Something went wrong on our side. Try again in a minute.");
      return;
    }
    setUsers(data);
    setShowPicker(true);
  };

  const startImpersonation = async (targetUserId: string) => {
    const res = await apiFetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId }),
    });
    if (!res.ok) {
      // Keep the user list open and do not reload, so the admin sees the message.
      toast.error(await apiErrorMessage(res, "Could not view as this user", "Refresh the page and try again."));
      return;
    }
    setShowPicker(false);
    router.refresh();
    window.location.reload();
  };

  const stopImpersonation = async () => {
    const res = await apiFetch("/api/admin/impersonate", { method: "DELETE" });
    if (!res.ok) {
      toast.error(await apiErrorMessage(res, "Could not stop viewing as this user", "Refresh the page and try again."));
      return;
    }
    router.refresh();
    window.location.reload();
  };

  // Impersonation active banner
  if (userInfo.isImpersonating) {
    return (
      <div className="bg-yellow-900/80 border-b border-yellow-700 px-4 py-2 flex items-center justify-between text-yellow-200">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4" />
          <span>Viewing as <strong>{userInfo.impersonatingEmail}</strong></span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={stopImpersonation}
          className="text-yellow-200 hover:text-yellow-100 hover:bg-yellow-800"
        >
          <EyeOff className="h-4 w-4 mr-1" />
          Stop Impersonating
        </Button>
      </div>
    );
  }

  // Admin toolbar
  return (
    <div className="relative">
      <div className="bg-card/50 border-b border-border px-4 py-1.5 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={loadUsers}
          className="text-muted-foreground hover:text-foreground gap-1.5"
        >
          <Users className="h-4 w-4" />
          View as User
        </Button>
        <span className="text-muted-foreground text-base">Admin</span>
      </div>

      {showPicker && (
        <div className="absolute top-full left-0 z-50 mt-1 ml-4 bg-popover border border-border rounded-md shadow-lg p-2 min-w-[250px] max-h-[300px] overflow-y-auto">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => startImpersonation(u.id)}
              className="w-full text-left px-3 py-2 rounded hover:bg-accent text-base transition-colors"
            >
              <div className="font-medium">{u.email}</div>
              {u.fullName && (
                <div className="text-muted-foreground text-base">{u.fullName}</div>
              )}
              <div className="text-muted-foreground text-base">{u.role}</div>
            </button>
          ))}
          {users.length === 0 && (
            <div className="px-3 py-2 text-muted-foreground">No users found</div>
          )}
        </div>
      )}
    </div>
  );
}
