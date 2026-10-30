import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopStatusBar } from './TopStatusBar';
import { InterruptedSessionBanner } from '../components/InterruptedSessionBanner';

export function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopStatusBar />
        <InterruptedSessionBanner />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
