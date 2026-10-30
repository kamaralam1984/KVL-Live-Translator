import { StatusPill, Toggle } from '@kvl/ui';
import { useConnectionStore } from '../state/connectionStore';
import { useThemeStore } from '../state/themeStore';
import { useNetworkStore } from '../state/networkStore';

const CONNECTION_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

const CONNECTION_STATE: Record<string, 'connecting' | 'connected' | 'error'> = {
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'error',
};

export function TopStatusBar() {
  const connectionStatus = useConnectionStore((s) => s.status);
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const isOnline = useNetworkStore((s) => s.isOnline);

  const isDark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/30 bg-background px-6">
      <div className="flex items-center gap-3">
        <StatusPill label={CONNECTION_LABEL[connectionStatus]} state={CONNECTION_STATE[connectionStatus]} />
        {!isOnline && (
          <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning" title="No internet connection — cloud AI features are unavailable, local features still work">
            ⚠ Offline — local features only
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[11px] font-medium text-muted">{isDark ? 'Dark' : 'Light'} mode</span>
        <Toggle checked={isDark} onChange={(checked) => setPreference(checked ? 'dark' : 'light')} aria-label="Toggle dark mode" />
      </div>
    </header>
  );
}
