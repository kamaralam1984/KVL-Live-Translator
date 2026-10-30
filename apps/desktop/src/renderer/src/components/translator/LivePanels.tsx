import { useEffect, useRef, type ReactNode } from 'react';
import type { TranscriptSegment, TranslationResultDTO } from '@kvl/shared';
import { Badge, ChatBubble, ChatStack, Toggle } from '@kvl/ui';
import { FONT_SIZE_PX, type FontSize } from '../../state/translatorUiStore';

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface ScrollPanelProps {
  itemCount: number;
  autoScroll: boolean;
  maxHeight: string;
  children: ReactNode;
}

/** Scrolls to bottom whenever itemCount grows, if autoScroll is on. A fixed
 * maxHeight (rather than flex-1/min-h-0) creates a real scroll boundary
 * regardless of the parent — AppShell's <main> already scrolls the whole
 * page, so this panel can't rely on flex-height propagation through it. */
function ScrollPanel({ itemCount, autoScroll, maxHeight, children }: ScrollPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [itemCount, autoScroll]);

  return (
    <div ref={ref} className="overflow-y-auto" style={{ maxHeight }}>
      {children}
    </div>
  );
}

interface EnglishPanelProps {
  transcript: TranscriptSegment[];
  fontSize: FontSize;
  autoScroll: boolean;
  maxHeight: string;
  /** Phase 8 "What does this mean?" — optional so callers that don't pass
   * these (the /mini window) keep today's exact non-interactive behavior. */
  selectedSegmentId?: string | null;
  onSelectSegment?: (segment: TranscriptSegment) => void;
}

function EnglishPanel({ transcript, fontSize, autoScroll, maxHeight, selectedSegmentId, onSelectSegment }: EnglishPanelProps) {
  if (transcript.length === 0) {
    return <p className="text-[12.5px] text-muted">Transcribed speech will appear here once a session is active.</p>;
  }
  return (
    <ScrollPanel itemCount={transcript.length} autoScroll={autoScroll} maxHeight={maxHeight}>
      <ChatStack>
        {transcript.map((segment) => (
          <div
            key={segment.id}
            className={`flex flex-col gap-1 ${onSelectSegment ? 'cursor-pointer rounded-md' : ''} ${
              onSelectSegment && selectedSegmentId === segment.id ? 'ring-1 ring-accent' : ''
            }`}
            onClick={onSelectSegment ? () => onSelectSegment(segment) : undefined}
          >
            <ChatBubble variant="ai">
              <span style={{ fontSize: FONT_SIZE_PX[fontSize] }}>{segment.text}</span>
            </ChatBubble>
            <div className="flex items-center gap-2 pl-1 text-[10.5px] text-muted">
              <span>{formatTimestamp(segment.startMs)}</span>
              {segment.languageCode && <span>· {segment.languageCode}</span>}
              {typeof segment.confidence === 'number' && (
                <Badge variant={segment.confidence >= 0.75 ? 'success' : 'warning'}>{Math.round(segment.confidence * 100)}%</Badge>
              )}
            </div>
          </div>
        ))}
      </ChatStack>
    </ScrollPanel>
  );
}

interface TranslationPanelProps {
  translations: TranslationResultDTO[];
  fontSize: FontSize;
  autoScroll: boolean;
  maxHeight: string;
}

function TranslationPanel({ translations, fontSize, autoScroll, maxHeight }: TranslationPanelProps) {
  if (translations.length === 0) {
    return <p className="text-[12.5px] text-muted">Translated text will appear here.</p>;
  }
  return (
    <ScrollPanel itemCount={translations.length} autoScroll={autoScroll} maxHeight={maxHeight}>
      <ChatStack>
        {translations.map((result, index) => (
          <div key={`${result.sessionId}-${index}`} className="flex flex-col gap-1">
            <ChatBubble variant="ai">
              <span className="text-accent-text" style={{ fontSize: FONT_SIZE_PX[fontSize] }}>
                {result.translatedText}
              </span>
            </ChatBubble>
            {typeof result.confidence === 'number' && (
              <span className="pl-1 text-[10.5px] text-muted">confidence {Math.round(result.confidence * 100)}%</span>
            )}
          </div>
        ))}
      </ChatStack>
    </ScrollPanel>
  );
}

export interface LivePanelsProps {
  transcript: TranscriptSegment[];
  translations: TranslationResultDTO[];
  translationModeLabel: string;
  fontSize: FontSize;
  autoScroll: boolean;
  /** Single-panel-with-toggle layout for the mini window / compact mode. */
  compact: boolean;
  showOriginal: boolean;
  onToggleShowOriginal: () => void;
  selectedSegmentId?: string | null;
  onSelectSegment?: (segment: TranscriptSegment) => void;
}

export function LivePanels({
  transcript,
  translations,
  translationModeLabel,
  fontSize,
  autoScroll,
  compact,
  showOriginal,
  onToggleShowOriginal,
  selectedSegmentId,
  onSelectSegment,
}: LivePanelsProps) {
  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted">
            {showOriginal ? 'Live English' : translationModeLabel}
          </h4>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-muted">{showOriginal ? 'EN' : 'HI'}</span>
            <Toggle checked={!showOriginal} onChange={onToggleShowOriginal} aria-label="Toggle original/translation" />
          </div>
        </div>
        {showOriginal ? (
          <EnglishPanel
            transcript={transcript}
            fontSize={fontSize}
            autoScroll={autoScroll}
            maxHeight="60vh"
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={onSelectSegment}
          />
        ) : (
          <TranslationPanel translations={translations} fontSize={fontSize} autoScroll={autoScroll} maxHeight="60vh" />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Live English</h4>
        <EnglishPanel
          transcript={transcript}
          fontSize={fontSize}
          autoScroll={autoScroll}
          maxHeight="42vh"
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={onSelectSegment}
        />
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">{translationModeLabel}</h4>
        <TranslationPanel translations={translations} fontSize={fontSize} autoScroll={autoScroll} maxHeight="42vh" />
      </div>
    </div>
  );
}
