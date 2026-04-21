import { Sidebar } from "@/components/layout/sidebar";
import { ImpersonationBar } from "@/components/admin/impersonation-bar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 overflow-auto pt-14 md:pt-0 flex flex-col">
        <ImpersonationBar />
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
