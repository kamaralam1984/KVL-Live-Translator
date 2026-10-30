import type { ExplanationContextMode } from '@kvl/shared';
import { Button, Card, useToast } from '@kvl/ui';
import { useExplainStore } from '../../state/explainStore';
import { TTSPanel } from '../tts/TTSPanel';
import { send } from '../../services/wsClient';

const CONTEXT_MODE_LABEL: Record<ExplanationContextMode, string> = {
  selected: 'Selected only',
  'last-1min': 'Last 1 min',
  'last-5min': 'Last 5 min',
  'current-topic': 'Current topic',
};

const ALL_CONTEXT_MODES: ExplanationContextMode[] = ['selected', 'last-1min', 'last-5min', 'current-topic'];

interface SectionProps {
  icon: string;
  title: string;
  text: string;
}

function Section({ icon, title, text }: SectionProps) {
  return (
    <div>
      <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {icon} {title}
      </h5>
      <p className="mt-1 text-[13px]">{text}</p>
    </div>
  );
}

interface ExplainPanelProps {
  sessionId: string;
}

/** Phase 8's "What does this mean?" panel — appears once a transcript
 * sentence is selected (LivePanels.tsx's onSelectSegment). Talks only to
 * explainStore + wsClient's send(); the backend resolves the actual
 * context window from its own TranscriptBuffer. */
export function ExplainPanel({ sessionId }: ExplainPanelProps) {
  const { selectedSegment, contextMode, draft, isExplaining, isSaving, lastSaved, lastError, setContextMode, startExplain, startSave, updateSuggestedResponse, clear } = useExplainStore();
  const { push } = useToast();

  if (!selectedSegment) return null;

  function handleExplain() {
    const requestId = startExplain();
    send({ type: 'explain:request', requestId, sessionId, segmentId: selectedSegment!.id, contextMode });
  }

  function handleSave() {
    if (!draft) return;
    const requestId = startSave();
    send({ type: 'explain:save', requestId, sessionId, draft });
  }

  async function handleCopy() {
    if (!draft) return;
    const text = [
      `Simple Meaning: ${draft.simpleMeaning}`,
      `What They're Asking: ${draft.whatTheyAreAsking}`,
      `Important Context: ${draft.importantContext}`,
      draft.terms.length ? `Terms: ${draft.terms.map((t) => `${t.term} = ${t.definition}`).join('; ')}` : '',
      `Suggested Response: ${draft.suggestedResponse}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      push('success', 'Explanation copied to clipboard');
    } catch {
      push('error', 'Could not copy — clipboard access was denied');
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Selected Sentence</h4>
        <Button variant="ghost" onClick={clear}>
          ✕ Clear
        </Button>
      </div>

      <p className="rounded-md bg-surface-tint/40 px-3 py-2 text-[13.5px] italic">"{selectedSegment.text}"</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase text-muted">Context</span>
        {ALL_CONTEXT_MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => setContextMode(mode)}
            className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors ${
              contextMode === mode ? 'bg-accent text-accent-ink' : 'bg-surface-tint text-muted hover:text-foreground'
            }`}
          >
            {CONTEXT_MODE_LABEL[mode]}
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="gold" onClick={handleExplain} disabled={isExplaining}>
          {isExplaining ? 'Explaining…' : 'What does this mean? →'}
        </Button>
      </div>

      {lastError && <p className="text-[12px] text-danger">{lastError}</p>}

      {draft && (
        <div className="flex flex-col gap-4 rounded-md border border-border/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">via {draft.providerId}</span>
          </div>

          <Section icon="🧠" title="Simple Meaning" text={draft.simpleMeaning} />
          <Section icon="❓" title="What They're Asking" text={draft.whatTheyAreAsking} />
          <Section icon="📌" title="Important Context" text={draft.importantContext} />

          {draft.terms.length > 0 && (
            <div>
              <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">📖 Important Terms</h5>
              <ul className="mt-1 flex flex-col gap-1">
                {draft.terms.map((t) => (
                  <li key={t.term} className="text-[12.5px]">
                    <span className="font-semibold">{t.term}</span> — {t.definition}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">💡 Suggested Response</h5>
            <textarea
              className="mt-1 min-h-[72px] w-full resize-y rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
              value={draft.suggestedResponse}
              onChange={(e) => updateSuggestedResponse(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={handleCopy}>
              Copy
            </Button>
            <Button variant="ghost" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving…' : lastSaved ? 'Saved ✓' : 'Save'}
            </Button>
          </div>

          {draft.suggestedResponse && <TTSPanel text={draft.suggestedResponse} />}
        </div>
      )}
    </Card>
  );
}
