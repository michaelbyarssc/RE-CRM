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
  Menu,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

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
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/welcome", label: "Welcome Tour", icon: GraduationCap },
  { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

function SidebarContent({
  pathname,
  userEmail,
  handleSignOut,
  onNavClick,
}: {
  pathname: string;
  userEmail: string | null;
  handleSignOut: () => void;
  onNavClick?: () => void;
}) {
  return (
    <>
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-xl font-bold tracking-tight text-gold">Deal Desk Pro</h1>
        <p className="text-xs text-gold-muted mt-1">
          Wholesale Deal Machine
        </p>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-[15px] font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
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
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null);
    });
  }, [supabase]);

  // Close sheet on route change
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      {/* Mobile header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center h-14 px-4 border-b bg-card">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" className="mr-3" />
            }
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 flex flex-col">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent
              pathname={pathname}
              userEmail={userEmail}
              handleSignOut={handleSignOut}
              onNavClick={() => setSheetOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <h1 className="text-lg font-bold tracking-tight text-gold">Deal Desk Pro</h1>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 border-r bg-card flex-col h-full">
        <SidebarContent
          pathname={pathname}
          userEmail={userEmail}
          handleSignOut={handleSignOut}
        />
      </aside>
    </>
  );
}
