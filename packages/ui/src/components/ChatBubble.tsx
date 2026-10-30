import type { ReactNode } from 'react';

export interface ChatBubbleProps {
  variant: 'mine' | 'ai';
  children: ReactNode;
}

export function ChatBubble({ variant, children }: ChatBubbleProps) {
  return <div className={`kvl-bubble ${variant === 'mine' ? 'kvl-bubble-mine' : 'kvl-bubble-ai'}`}>{children}</div>;
}

export interface ChatStackProps {
  children: ReactNode;
}

export function ChatStack({ children }: ChatStackProps) {
  return <div className="kvl-chat-stack">{children}</div>;
}
