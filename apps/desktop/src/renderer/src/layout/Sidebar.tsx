import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/translator', label: 'Meeting Translator' },
  { to: '/my-response', label: 'My Response' },
  { to: '/settings', label: 'Settings' },
  { to: '/history', label: 'Translation History' },
  { to: '/meetings', label: 'Meeting History' },
  { to: '/providers', label: 'API Providers' },
  { to: '/usage', label: 'API Usage' },
  { to: '/security', label: 'Security' },
  { to: '/diagnostics', label: 'Audio Diagnostics' },
  { to: '/debug', label: 'Debug' },
  { to: '/about', label: 'About' },
];

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-border/30 bg-surface px-3 py-5">
      <div className="mb-4 px-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">KVL Live Translator</span>
        </div>
      </div>

      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `relative rounded-md px-3 py-2.5 text-[13px] font-semibold transition-colors ${
              isActive ? 'bg-surface-tint text-foreground' : 'text-muted hover:bg-surface-tint/60 hover:text-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <span className="flex items-center gap-2">
              {isActive && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent" />}
              {item.label}
            </span>
          )}
        </NavLink>
      ))}
    </aside>
  );
}
