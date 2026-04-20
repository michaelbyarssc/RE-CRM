export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-lg font-bold tracking-tight text-gold">Deal Desk Pro</a>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <a href="/privacy" className="hover:text-gold transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-gold transition-colors">Terms</a>
            <a href="/login" className="hover:text-gold transition-colors">Sign In</a>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
