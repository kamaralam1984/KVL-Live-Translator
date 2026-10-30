import { useState } from 'react';
import { Button } from '@kvl/ui';
import { useInterruptedSessionsStore } from '../state/interruptedSessionsStore';
import { send } from '../services/wsClient';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Phase 14 crash recovery: shown app-wide (inside AppShell, above every
 * screen) when session:check-interrupted finds a meeting_sessions row that
 * never got a clean session:end — meaning the app crashed or was force-quit
 * mid-meeting. No raw audio is ever recovered here; only the already-durable
 * transcript/copilot data (safely in the DB since Phase 10) is at stake. */
export function InterruptedSessionBanner() {
  const { sessions, dismissed, dismiss } = useInterruptedSessionsStore();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (dismissed || sessions.length === 0) return null;

  const latest = sessions[0];
  const extraCount = sessions.length - 1;

  function handleRecover(sessionId: string) {
    send({ type: 'session:recover', sessionId });
  }

  function handleDelete(sessionId: string) {
    if (confirmDeleteId !== sessionId) {
      setConfirmDeleteId(sessionId);
      return;
    }
    send({ type: 'meetings:delete', sessionId }); // broadcasts meetings:deleted, which wsClient also removes from this store
    setConfirmDeleteId(null);
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/15 px-6 py-3 text-sm text-foreground"
    >
      <span className="flex-1">
        <strong className="font-semibold text-warning">Unclosed meeting found —</strong>{' '}
        &quot;{latest.title ?? 'Untitled meeting'}&quot; started {formatDate(latest.startedAt)} wasn&apos;t closed
        properly, likely from a crash or force-quit.
        {extraCount > 0 ? ` (+${extraCount} more)` : ''}
      </span>
      <Button variant="gold" onClick={() => handleRecover(latest.id)}>
        Recover
      </Button>
      <Button variant="danger" onClick={() => handleDelete(latest.id)}>
        {confirmDeleteId === latest.id ? 'Confirm delete' : 'Delete'}
      </Button>
      <Button variant="ghost" onClick={dismiss} aria-label="Dismiss unclosed meeting notice">
        Dismiss
      </Button>
    </div>
  );
}
