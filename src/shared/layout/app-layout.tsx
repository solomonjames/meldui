import type { ReactNode } from "react";

interface AppLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
  statusBar: ReactNode;
}

export function AppLayout({ sidebar, children, statusBar }: AppLayoutProps) {
  return (
    <div className="h-screen flex flex-col">
      <div className="flex flex-1 overflow-hidden">
        {sidebar}
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </div>
      {statusBar}
    </div>
  );
}
