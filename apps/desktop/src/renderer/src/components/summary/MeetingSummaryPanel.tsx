import { useState } from 'react';
import type { CopilotItemDTO, MeetingSummaryDTO } from '@kvl/shared';
import { Badge, Button, Card, useToast } from '@kvl/ui';
import { useSummaryStore } from '../../state/summaryStore';
import { send } from '../../services/wsClient';

const CONFIRMED_SECTIONS: Array<{ key: keyof MeetingSummaryDTO; icon: string; title: string }> = [
  { key: 'clientRequirements', icon: '📋', title: 'Client Requirements' },
  { key: 'decisions', icon: '📌', title: 'Decisions' },
  { key: 'actionItems', icon: '✅', title: 'Action Items' },
  { key: 'deadlines', icon: '⏰', title: 'Deadlines' },
  { key: 'questions', icon: '❓', title: 'Questions' },
  { key: 'risks', icon: '⚠️', title: 'Risks / Concerns' },
  { key: 'followUpItems', icon: '🔁', title: 'Follow-up Items' },
];

function bulletsToText(items: string[]): string {
  return items.join('\n');
}
function textToBullets(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildPlainText(draft: MeetingSummaryDTO): string {
  const lines: string[] = ['MEETING SUMMARY', '', 'EXECUTIVE SUMMARY:', draft.executiveSummary, '', 'MEETING OBJECTIVE:', draft.meetingObjective, ''];
  lines.push('KEY DISCUSSION POINTS:', ...draft.keyDiscussionPoints.map((p) => `• ${p}`), '');
  for (const section of CONFIRMED_SECTIONS) {
    const items = draft[section.key] as CopilotItemDTO[];
    if (items.length === 0) continue;
    lines.push(`${section.title.toUpperCase()}:`, ...items.map((i) => `${i.category === 'action-item' ? '☐' : '•'} ${i.description}${i.owner ? ` (owner: ${i.owner})` : ''}${i.dueText ? ` — due ${i.dueText}` : ''}`), '');
  }
  lines.push('SUGGESTED NEXT STEPS:', ...draft.suggestedNextSteps.map((s) => `• ${s}`));
  return lines.join('\n');
}

function buildMarkdown(draft: MeetingSummaryDTO): string {
  const lines: string[] = ['# Meeting Summary', '', '## Executive Summary', draft.executiveSummary, '', '## Meeting Objective', draft.meetingObjective, ''];
  lines.push('## Key Discussion Points', ...draft.keyDiscussionPoints.map((p) => `- ${p}`), '');
  for (const section of CONFIRMED_SECTIONS) {
    const items = draft[section.key] as CopilotItemDTO[];
    if (items.length === 0) continue;
    lines.push(`## ${section.title}`, ...items.map((i) => `- ${i.description}${i.owner ? ` *(owner: ${i.owner})*` : ''}${i.dueText ? ` — due ${i.dueText}` : ''}`), '');
  }
  lines.push('## Suggested Next Steps', ...draft.suggestedNextSteps.map((s) => `- ${s}`));
  return lines.join('\n');
}

function buildHtml(draft: MeetingSummaryDTO): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bulletList = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const confirmedList = (items: CopilotItemDTO[]) =>
    `<ul>${items.map((i) => `<li>${esc(i.description)}${i.owner ? ` <em>(owner: ${esc(i.owner)})</em>` : ''}${i.dueText ? ` — due ${esc(i.dueText)}` : ''}</li>`).join('')}</ul>`;
  const sections = CONFIRMED_SECTIONS.map((section) => {
    const items = draft[section.key] as CopilotItemDTO[];
    if (items.length === 0) return '';
    return `<h2>${section.icon} ${esc(section.title)}</h2>${confirmedList(items)}`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Arial, sans-serif; padding: 32px; color: #1a1a1a; }
    h1 { font-size: 22px; } h2 { font-size: 15px; margin-top: 20px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    ul { margin: 6px 0; padding-left: 20px; } li { margin: 3px 0; font-size: 13px; }
    p { font-size: 13px; line-height: 1.5; }
  </style></head><body>
    <h1>Meeting Summary</h1>
    <h2>Executive Summary</h2><p>${esc(draft.executiveSummary)}</p>
    <h2>Meeting Objective</h2><p>${esc(draft.meetingObjective)}</p>
    <h2>Key Discussion Points</h2>${bulletList(draft.keyDiscussionPoints)}
    ${sections}
    <h2>Suggested Next Steps</h2>${bulletList(draft.suggestedNextSteps)}
  </body></html>`;
}

interface MeetingSummaryPanelProps {
  sessionId: string;
}

/** Phase 10's Generate/Regenerate/Edit/Copy/Download×3/Export JSON/Save/
 * Delete panel. Visually separates the 4 AI-synthesized fields from the 7
 * confirmed-fact sections (live-queried CopilotItems) — the concrete UI
 * form of "clearly distinguish CONFIRMED FACTS from AI INTERPRETATION". */
export function MeetingSummaryPanel({ sessionId }: MeetingSummaryPanelProps) {
  const { draft, isGenerating, isSaving, lastSaved, lastError, startGenerate, startSave, startDelete, updateDraft } = useSummaryStore();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);

  function handleGenerate() {
    const requestId = startGenerate();
    send({ type: 'summary:generate', requestId, sessionId });
  }

  function handleSave() {
    if (!draft) return;
    const requestId = startSave();
    send({ type: 'summary:save', requestId, sessionId, draft });
  }

  function handleDelete() {
    const requestId = startDelete();
    send({ type: 'summary:delete', requestId, sessionId });
  }

  async function handleCopy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(buildPlainText(draft));
      push('success', 'Summary copied to clipboard');
    } catch {
      push('error', 'Could not copy — clipboard access was denied');
    }
  }

  async function handleDownload(kind: 'txt' | 'md' | 'json') {
    if (!draft) return;
    const content = kind === 'txt' ? buildPlainText(draft) : kind === 'md' ? buildMarkdown(draft) : JSON.stringify(draft, null, 2);
    const label = kind === 'txt' ? 'Text' : kind === 'md' ? 'Markdown' : 'JSON';
    const ok = await window.kvlAPI.saveTextFile(content, `meeting-summary.${kind}`, [{ name: label, extensions: [kind] }]);
    if (ok) push('success', `${label} saved`);
  }

  async function handleExportPdf() {
    if (!draft) return;
    try {
      const ok = await window.kvlAPI.exportSummaryPdf(buildHtml(draft), 'meeting-summary.pdf');
      if (ok) push('success', 'PDF saved');
    } catch {
      push('error', 'Could not export PDF');
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">📄 Meeting Summary</h4>
        <Button variant="gold" onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? 'Generating…' : draft ? 'Regenerate' : 'Generate Summary'}
        </Button>
      </div>

      {lastError && <p className="text-[12px] text-danger">{lastError}</p>}

      {draft && (
        <>
          <div className="flex flex-col gap-3">
            <Badge variant="gold">🤖 AI Interpretation</Badge>

            <div>
              <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">Executive Summary</h5>
              {editing ? (
                <textarea
                  className="mt-1 min-h-[60px] w-full resize-y rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
                  value={draft.executiveSummary}
                  onChange={(e) => updateDraft({ executiveSummary: e.target.value })}
                />
              ) : (
                <p className="mt-1 text-[13px]">{draft.executiveSummary}</p>
              )}
            </div>

            <div>
              <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">Meeting Objective</h5>
              {editing ? (
                <textarea
                  className="mt-1 min-h-[44px] w-full resize-y rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
                  value={draft.meetingObjective}
                  onChange={(e) => updateDraft({ meetingObjective: e.target.value })}
                />
              ) : (
                <p className="mt-1 text-[13px]">{draft.meetingObjective}</p>
              )}
            </div>

            <div>
              <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">Key Discussion Points</h5>
              {editing ? (
                <textarea
                  className="mt-1 min-h-[60px] w-full resize-y rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
                  value={bulletsToText(draft.keyDiscussionPoints)}
                  onChange={(e) => updateDraft({ keyDiscussionPoints: textToBullets(e.target.value) })}
                  placeholder="One point per line"
                />
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {draft.keyDiscussionPoints.map((point, i) => (
                    <li key={i} className="text-[13px]">
                      • {point}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-border/20 p-3">
            <Badge variant="success">✓ Confirmed Facts</Badge>
            {CONFIRMED_SECTIONS.map((section) => {
              const items = draft[section.key] as CopilotItemDTO[];
              if (items.length === 0) return null;
              return (
                <div key={section.key}>
                  <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    {section.icon} {section.title} ({items.length})
                  </h5>
                  <ul className="mt-1 flex flex-col gap-1">
                    {items.map((item) => (
                      <li key={item.id} className="text-[12.5px]">
                        {item.category === 'action-item' ? '☐' : '•'} {item.description}
                        {item.owner && <span className="ml-1 text-[11px] text-muted">(owner: {item.owner})</span>}
                        {item.dueText && <span className="ml-1 text-[11px] text-muted">— due {item.dueText}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {CONFIRMED_SECTIONS.every((s) => (draft[s.key] as CopilotItemDTO[]).length === 0) && (
              <p className="text-[12px] text-muted">No confirmed meeting items yet — confirm items on the Meeting Copilot panel during the meeting.</p>
            )}
          </div>

          <div>
            <h5 className="text-[11px] font-bold uppercase tracking-wide text-muted">💡 Suggested Next Steps</h5>
            {editing ? (
              <textarea
                className="mt-1 min-h-[44px] w-full resize-y rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
                value={bulletsToText(draft.suggestedNextSteps)}
                onChange={(e) => updateDraft({ suggestedNextSteps: textToBullets(e.target.value) })}
                placeholder="One step per line"
              />
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {draft.suggestedNextSteps.map((step, i) => (
                  <li key={i} className="text-[13px]">
                    • {step}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done Editing' : 'Edit'}
            </Button>
            <Button variant="ghost" onClick={handleCopy}>
              Copy
            </Button>
            <Button variant="ghost" onClick={() => handleDownload('txt')}>
              Download TXT
            </Button>
            <Button variant="ghost" onClick={() => handleDownload('md')}>
              Download Markdown
            </Button>
            <Button variant="ghost" onClick={handleExportPdf}>
              Download PDF
            </Button>
            <Button variant="ghost" onClick={() => handleDownload('json')}>
              Export JSON
            </Button>
            <Button variant="secondary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving…' : lastSaved ? 'Saved ✓' : 'Save locally'}
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete permanently
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
