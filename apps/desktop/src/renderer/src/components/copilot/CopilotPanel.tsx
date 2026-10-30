import { useState } from 'react';
import type { CopilotCategory, CopilotItemDTO } from '@kvl/shared';
import { Badge, Button, Card } from '@kvl/ui';
import { useCopilotStore } from '../../state/copilotStore';
import { send } from '../../services/wsClient';

const CATEGORY_META: Record<CopilotCategory, { icon: string; label: string }> = {
  question: { icon: '❓', label: 'Questions' },
  'action-item': { icon: '✅', label: 'Action Items' },
  decision: { icon: '📌', label: 'Decisions' },
  deadline: { icon: '⏰', label: 'Deadlines' },
  'client-request': { icon: '⭐', label: 'Client Requests' },
  requirement: { icon: '📋', label: 'Requirements' },
  objection: { icon: '⚠️', label: 'Objections' },
  'pricing-discussion': { icon: '💰', label: 'Pricing Discussions' },
  'technical-requirement': { icon: '🛠️', label: 'Technical Requirements' },
  'follow-up': { icon: '🔁', label: 'Follow-ups' },
};

// Prioritizes high-value categories first (see the Phase 9 plan).
const CATEGORY_ORDER: CopilotCategory[] = Object.keys(CATEGORY_META) as CopilotCategory[];

const COMPLETABLE_CATEGORIES = new Set<CopilotCategory>(['action-item', 'deadline', 'follow-up']);

/** Phase 9's "Meeting Copilot" panel — grouped-by-category live list of
 * automatically detected items. Talks only to copilotStore + wsClient's
 * send(); MeetingTranslator.tsx owns sending copilot:list on session
 * start/resume (this component just renders whatever the store holds). */
export function CopilotPanel() {
  const { items, isCollapsed, toggleCollapsed } = useCopilotStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const grouped = new Map<CopilotCategory, CopilotItemDTO[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  function handleConfirm(id: string) {
    send({ type: 'copilot:confirm', itemId: id });
  }
  function handleComplete(id: string) {
    send({ type: 'copilot:complete', itemId: id });
  }
  function handleDelete(id: string) {
    send({ type: 'copilot:delete', itemId: id });
  }
  function startEdit(item: CopilotItemDTO) {
    setEditingId(item.id);
    setEditText(item.description);
  }
  function saveEdit(id: string) {
    send({ type: 'copilot:edit', itemId: id, patch: { description: editText } });
    setEditingId(null);
  }

  const totalCount = items.length;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">
          🧠 Meeting Copilot {totalCount > 0 && `(${totalCount})`}
        </h4>
        <Button variant="ghost" onClick={toggleCollapsed}>
          {isCollapsed ? 'Expand' : 'Collapse'}
        </Button>
      </div>

      {!isCollapsed &&
        (totalCount === 0 ? (
          <p className="text-[12.5px] text-muted">Copilot will surface questions, decisions, action items, and more here as the meeting happens.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => {
              const categoryItems = grouped.get(category)!;
              const meta = CATEGORY_META[category];
              return (
                <div key={category} className="flex flex-col gap-2 border-t border-border/20 pt-3 first:border-t-0 first:pt-0">
                  <h5 className="text-[11.5px] font-bold uppercase tracking-wide text-muted">
                    {meta.icon} {meta.label} ({categoryItems.length})
                  </h5>
                  <ul className="flex flex-col gap-2">
                    {categoryItems.map((item) => (
                      <li key={item.id} className="flex flex-col gap-1 rounded-md bg-surface-tint/40 px-3 py-2">
                        {editingId === item.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              className="flex-1 rounded-md border border-border/30 bg-surface px-2 py-1 text-[12.5px] text-foreground"
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                            />
                            <Button variant="gold" onClick={() => saveEdit(item.id)}>
                              Save
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <span className={`text-[13px] ${item.status === 'completed' ? 'text-muted line-through' : ''}`}>
                              • {item.description}
                              {item.owner && <span className="ml-1 text-[11px] text-muted">(owner: {item.owner})</span>}
                              {item.dueText && <span className="ml-1 text-[11px] text-muted">— due {item.dueText}</span>}
                            </span>
                            <Badge variant={item.confidence >= 0.75 ? 'success' : 'warning'}>{Math.round(item.confidence * 100)}%</Badge>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          {item.status === 'new' && (
                            <Button variant="ghost" onClick={() => handleConfirm(item.id)}>
                              Confirm
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => startEdit(item)}>
                            Edit
                          </Button>
                          {COMPLETABLE_CATEGORIES.has(item.category) && item.status !== 'completed' && (
                            <Button variant="ghost" onClick={() => handleComplete(item.id)}>
                              Mark Complete
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => handleDelete(item.id)}>
                            Delete
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
    </Card>
  );
}
