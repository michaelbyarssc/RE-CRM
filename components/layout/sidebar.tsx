"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

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
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-card flex flex-col h-full">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold tracking-tight">RE CRM</h1>
        <p className="text-xs text-muted-foreground mt-1">Wholesale Deal Machine</p>
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
    </aside>
  );
}
