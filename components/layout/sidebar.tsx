"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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

// True once this page has signed the user out. A browser can keep the page in
// memory and show it again on Back, so it must never be shown again as it was.
let signedOutOnThisPage = false;

// The Supabase sign-in cookie: "sb-<project>-auth-token", split into ".0", ".1"
// and so on when it is long. It is readable here (not httpOnly).
function hasSignInCookie() {
  return /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=[^;]/.test(document.cookie);
}

// Hide the page and load it again from the server, which sends a signed-out
// visitor to /login.
function reloadFromServer() {
  document.documentElement.style.visibility = "hidden";
  window.location.reload();
}

// The proxy never lets a signed-out visitor reach a page with this sidebar.
// So if one shows up without the sign-in cookie, or after this page signed
// out, the browser took it from memory or from its cache (for example on the
// Back button after Sign Out) and it may still show the user's data.
function reloadIfSignedOut(event?: PageTransitionEvent) {
  if (["/login", "/privacy", "/terms"].includes(window.location.pathname)) return;
  if (!signedOutOnThisPage && hasSignInCookie()) return;
  // Restored from memory (the Back or Forward button): always ask the server.
  if (event?.persisted) return reloadFromServer();
  // A page that came from a reload came from the server, and the proxy only
  // serves it to a signed-in visitor. Reloading again could loop forever if
  // the cookie check above were ever wrong, so stop here.
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type === "reload") return;
  // Otherwise the browser took the page from its cache without asking the server.
  reloadFromServer();
}

// Runs when this code is first loaded in the browser, before React starts the
// page and before the page asks for its data. "pageshow" also fires when a page
// is restored from memory, which runs no code again.
if (typeof window !== "undefined") {
  reloadIfSignedOut();
  window.addEventListener("pageshow", reloadIfSignedOut);
}

function SidebarContent({
  pathname,
  userEmail,
  handleSignOut,
  signingOut,
  onNavClick,
}: {
  pathname: string;
  userEmail: string | null;
  handleSignOut: () => void;
  signingOut: boolean;
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
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-base font-medium transition-colors",
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
            disabled={signingOut}
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Signing out..." : "Sign Out"}
          </Button>
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // The Supabase client is created in the browser only (not while the page is
  // prerendered at build time, when its settings may not be available).
  useEffect(() => {
    createSupabaseBrowserClient().auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null);
    });
  }, []);

  // Close sheet on route change
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    let failed = false;
    let noConnection = false;
    try {
      // signOut() does not throw when the sign-in service refuses or cannot be
      // reached: it returns the error and keeps the user signed in.
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) {
        failed = true;
        noConnection = error.status === 0;
      }
    } catch {
      failed = true;
      noConnection = true;
    }
    if (failed) {
      setSigningOut(false);
      toast.error(
        noConnection
          ? "Could not sign out. Check your internet connection and try again."
          : "Could not sign out. Something went wrong on our side. Try again in a minute."
      );
      return;
    }
    // A full page load, not router.push("/login") plus router.refresh(). The
    // refresh made the router fetch again every sidebar link still on screen
    // (prefetching). The proxy sends those signed-out requests to /login,
    // which has no data for them, so the browser logged a 404 for each one.
    // A browser may keep this page in memory and show it again on Back. It is
    // hidden first, so a kept copy is blank, and the "pageshow" check above
    // reloads it from the server, which sends the visitor to /login.
    signedOutOnThisPage = true;
    document.documentElement.style.visibility = "hidden";
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full page load is the point here, see above
    window.location.assign("/login");
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
              signingOut={signingOut}
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
          signingOut={signingOut}
        />
      </aside>
    </>
  );
}
