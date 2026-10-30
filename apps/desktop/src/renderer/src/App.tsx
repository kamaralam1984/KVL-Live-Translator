import { useEffect } from 'react';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary, ToastProvider, useThemeSync, useToast } from '@kvl/ui';
import { useThemeStore } from './state/themeStore';
import { useTranslatorUiStore } from './state/translatorUiStore';
import { useMeetingStore } from './state/meetingStore';
import { connect, send, setErrorNotifier, setCopilotNotifier, setBudgetNotifier } from './services/wsClient';
import { installNetworkStatusListener } from './state/networkStore';
import { AppRoutes } from './router';

/** Global keyboard shortcuts only ever reach the MAIN window — the main
 * process sends 'shortcut:trigger' only to mainWindow.webContents (see
 * apps/desktop/src/main/index.ts) — so this listener sitting idle in the
 * mini window (which also mounts this component) is harmless; it just
 * never fires there. Window-level shortcuts (toggle mini window/always-on-
 * top/interaction/mode) are handled entirely in the main process — only
 * these two meeting-session-state actions route here. */
function handleShortcut(action: string): void {
  if (action === 'toggleTranslationPause') {
    const ui = useTranslatorUiStore.getState();
    const sessionId = useMeetingStore.getState().sessionId;
    if (!sessionId) return;
    if (ui.translationPaused) {
      send({ type: 'translation:resume', sessionId });
      ui.setTranslationPaused(false);
    } else {
      send({ type: 'translation:pause', sessionId });
      ui.setTranslationPaused(true);
    }
  } else if (action === 'toggleResponsePanel') {
    useTranslatorUiStore.getState().toggleShowResponsePanel();
  }
}

/** Phase 14: only codes whose backend-side message is raw `error.message`
 * (a caught exception's own text, not hand-written copy) need an override —
 * every other code's message is already user-facing prose written at the
 * broadcast site (e.g. SAVE_DISABLED, COST_MODE_BLOCKED) and passes through
 * unchanged. The raw `code: message` always still goes to console.error. */
const FRIENDLY_ERROR_MESSAGE: Partial<Record<string, string>> = {
  TRANSLATION_FAILED: 'Translation failed for that segment — it will retry automatically on the next one.',
  STT_FAILED: 'Speech recognition failed for that audio chunk — it will retry automatically on the next one.',
  RESPONSE_STT_FAILED: 'Could not transcribe that recording. Please try recording again.',
  RESPONSE_GENERATE_FAILED: 'Could not generate a response right now. Please try again in a moment.',
  TTS_SYNTHESIZE_FAILED: 'Could not generate speech for that text. Please try again.',
  EXPLAIN_FAILED: 'Could not generate an explanation. Please try again.',
  EXPLAIN_SAVE_FAILED: 'Could not save that explanation. Please try again.',
  SUMMARY_GENERATE_FAILED: 'Could not generate a summary right now. Please try again.',
  SUMMARY_SAVE_FAILED: 'Could not save the summary. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on the backend. Please try again.',
};

function ConnectionBootstrap() {
  const { push } = useToast();

  useEffect(() => {
    setErrorNotifier((code, message) => {
      console.error(`${code}: ${message}`);
      push('error', FRIENDLY_ERROR_MESSAGE[code] ?? message);
    });
    setCopilotNotifier((message) => push('info', message));
    setBudgetNotifier((message) => {
      const variant = message.percent >= 100 ? 'error' : 'warning';
      push(variant, `Monthly AI budget ${message.percent}% used ($${message.monthCostUsd.toFixed(2)} of $${message.monthlyBudgetUsd.toFixed(2)})`);
    });
    window.kvlAPI.getConnectionInfo().then(({ port, token }) => connect(port, token));
    send({ type: 'usage:get' });
    send({ type: 'session:check-interrupted' });
    const uninstallNetworkListener = installNetworkStatusListener();
    const uninstallShortcutListener = window.kvlAPI.onShortcut(handleShortcut);
    return () => {
      setErrorNotifier(null);
      setCopilotNotifier(null);
      setBudgetNotifier(null);
      uninstallNetworkListener();
      uninstallShortcutListener();
    };
  }, [push]);

  return null;
}

/** Phase 15: redirects to the first-run setup wizard exactly once, on a
 * fresh install (or after "Redo Setup Wizard" in Settings resets the flag).
 * Skips the mini window entirely (loaded at #/mini, a separate BrowserWindow
 * mounting this same renderer bundle — redirecting it would break the
 * floating window, which has no sidebar/nav to return from) and skips
 * re-redirecting once already on /setup. */
function FirstRunGuard() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/mini' || location.pathname === '/setup') return;
    window.kvlAPI.getFirstRunStatus().then((completed) => {
      if (!completed) navigate('/setup', { replace: true });
    });
    // Only ever run once per mount (app boot) — not on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function ThemedApp() {
  const preference = useThemeStore((s) => s.preference);
  useThemeSync(preference);

  return (
    <>
      <ConnectionBootstrap />
      <FirstRunGuard />
      <AppRoutes />
    </>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <ThemedApp />
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
