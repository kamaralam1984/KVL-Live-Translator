import { useEffect, useState } from 'react';
import type { SessionCostDTO } from '@kvl/shared';
import { Badge, Button, Card } from '@kvl/ui';
import { useMeetingHistoryStore } from '../state/meetingHistoryStore';
import { useSummaryStore } from '../state/summaryStore';
import { MeetingSummaryPanel } from '../components/summary/MeetingSummaryPanel';
import { onUsageSessionCost, send } from '../services/wsClient';

function randomRequestId(): string {
  return `usage-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '—';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Phase 10's Meeting History — Date/Duration/Title/Language/segment count/
 * action-item count/summary status, per meeting, exactly the phase's own
 * list. Clicking a row reuses MeetingSummaryPanel to view/edit/export that
 * meeting's summary; Delete permanently cascades the whole meeting. */
export function MeetingHistory() {
  const meetings = useMeetingHistoryStore((s) => s.meetings);
  const { startFetch, clear: clearSummary } = useSummaryStore();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sessionCost, setSessionCost] = useState<SessionCostDTO | null>(null);

  useEffect(() => {
    send({ type: 'meetings:list' });
    return onUsageSessionCost((message) => setSessionCost(message.cost));
  }, []);

  function handleView(sessionId: string) {
    clearSummary();
    setSelectedSessionId(sessionId);
    setSessionCost(null);
    const requestId = startFetch();
    send({ type: 'summary:get', requestId, sessionId });
    send({ type: 'usage:get-session', requestId: randomRequestId(), sessionId });
  }

  function handleDelete(sessionId: string) {
    if (confirmDeleteId !== sessionId) {
      setConfirmDeleteId(sessionId);
      return;
    }
    send({ type: 'meetings:delete', sessionId });
    setConfirmDeleteId(null);
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
      clearSummary();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Meeting History</h1>
        <p className="mt-1 text-[13px] text-muted">Past meetings — view a saved summary, or delete a meeting's full record permanently.</p>
      </div>

      {meetings.length === 0 ? (
        <Card>
          <p className="text-[12.5px] text-muted">No meetings yet — start one from Meeting Translator.</p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-2 p-0">
          {meetings.map((meeting) => (
            <div
              key={meeting.sessionId}
              className={`flex flex-wrap items-center justify-between gap-2 border-b border-border/10 px-4 py-3 last:border-b-0 ${
                selectedSessionId === meeting.sessionId ? 'bg-surface-tint/40' : ''
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{meeting.title || 'Untitled meeting'}</span>
                <span className="text-[11px] text-muted">
                  {formatDate(meeting.startedAt)} · {formatDuration(meeting.durationMs)} · {meeting.language} · {meeting.segmentCount} segments · {meeting.actionItemCount} action items
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={meeting.hasSummary ? 'success' : 'neutral'}>{meeting.hasSummary ? 'Summary saved' : 'No summary'}</Badge>
                <Button variant="ghost" onClick={() => handleView(meeting.sessionId)}>
                  View
                </Button>
                <Button variant="danger" onClick={() => handleDelete(meeting.sessionId)}>
                  {confirmDeleteId === meeting.sessionId ? 'Confirm delete' : 'Delete'}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {selectedSessionId && sessionCost && sessionCost.sessionId === selectedSessionId && (
        <Card className="flex items-center justify-between">
          <span className="text-[12.5px] text-muted">Estimated cost for this meeting</span>
          <span className="text-[13px] font-semibold">
            ${sessionCost.totalCostUsd.toFixed(4)} <span className="text-muted">({sessionCost.requestCount} cloud requests)</span>
          </span>
        </Card>
      )}

      {selectedSessionId && <MeetingSummaryPanel sessionId={selectedSessionId} />}
    </div>
  );
}
