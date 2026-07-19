import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { Sidebar } from "./Sidebar";

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  // Anonymous visitors (or auth still resolving) get the page full-width,
  // no app chrome - the public landing page and the auth pages rely on this.
  if (loading || !user) return <>{children}</>;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">{children}</main>
    </div>
  );
}
