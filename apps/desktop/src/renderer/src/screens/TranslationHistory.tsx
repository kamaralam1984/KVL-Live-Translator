import { useEffect, useState } from 'react';
import type { TranslationResultDTO } from '@kvl/shared';
import { Card } from '@kvl/ui';
import { onHistoryData, send } from '../services/wsClient';

export function TranslationHistory() {
  const [entries, setEntries] = useState<TranslationResultDTO[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const unsubscribe = onHistoryData((message) => {
      setEntries(message.entries);
      setTotal(message.total);
    });
    send({ type: 'history:list', limit: 50, offset: 0 });
    return unsubscribe;
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Translation History</h1>
        <p className="mt-1 text-[13px] text-muted">{total} saved translation{total === 1 ? '' : 's'} across all sessions.</p>
      </div>

      {entries.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="text-[13px] font-semibold">No history yet</span>
          <span className="max-w-sm text-[12px] text-muted">
            Start a session in Meeting Translator and translated segments will show up here.
          </span>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry, index) => (
            <Card key={`${entry.sessionId}-${index}`} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
                <span>{entry.mode}</span>
              </div>
              <p className="text-[13px] text-foreground">{entry.originalText}</p>
              <p className="text-[13px] text-accent-text">{entry.translatedText}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
