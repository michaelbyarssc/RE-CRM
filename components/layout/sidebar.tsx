"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Users,
  Upload,
  Map,
  ListOrdered,
  LayoutDashboard,
  Phone,
  Kanban,
  Search,
  UserCheck,
  LogOut,
  GraduationCap,
  BookOpen,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/leads/import", label: "Import CSV", icon: Upload },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/map", label: "Map", icon: Map },
  { href: "/sequences", label: "Sequences", icon: ListOrdered },
  { href: "/skip-trace", label: "Skip Trace", icon: Search },
  { href: "/dialer", label: "Dialer", icon: Phone },
  { href: "/buyers", label: "Buyers", icon: UserCheck },
  { href: "/welcome", label: "Welcome Tour", icon: GraduationCap },
  { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null);
    });
  }, [supabase]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="w-64 border-r bg-card flex flex-col h-full">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold tracking-tight">Deal Desk Pro</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Wholesale Deal Machine
        </p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {userEmail && (
        <div className="p-3 border-t">
          <div className="px-3 py-2">
            <p className="text-xs text-muted-foreground truncate">
              {userEmail}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      )}
    </aside>
  );
}
