import type { ResponseStyle } from '@kvl/shared';

/** Human-readable labels for the style picker UI. */
export const RESPONSE_STYLE_LABELS: Record<ResponseStyle, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  short: 'Short',
  detailed: 'Detailed',
  'client-friendly': 'Client-Friendly',
  technical: 'Technical',
  'simple-english': 'Simple English',
};

/**
 * Single source of truth for the per-style system-prompt fragment
 * CloudResponseProvider uses — pure data, zero I/O, fully unit-testable
 * without a network call. Mirrors CloudTranslationProvider.ts's
 * MODE_INSTRUCTIONS pattern (Phase 4), same idea for the reverse direction.
 */
export const STYLE_INSTRUCTIONS: Record<ResponseStyle, string> = {
  professional: 'Rewrite in clear, professional business English suitable for a work meeting — polished but natural, not stiff.',
  friendly: 'Rewrite in warm, friendly, conversational English, as you would speak to a trusted colleague.',
  short: 'Rewrite as a short, to-the-point English sentence or two — cut anything not essential.',
  detailed: 'Rewrite as a detailed, thorough English explanation, spelling out context and reasoning the listener would find useful.',
  'client-friendly': 'Rewrite in polite, client-facing English — reassuring, no internal jargon, appropriate for an external stakeholder.',
  technical: 'Rewrite in precise, technical English appropriate for an engineering discussion — keep technical terms exact.',
  'simple-english': 'Rewrite using short sentences and common, simple vocabulary suitable for a non-native English speaker.',
};

export function getStyleInstruction(style: ResponseStyle): string {
  return STYLE_INSTRUCTIONS[style];
}

export function getStyleLabel(style: ResponseStyle): string {
  return RESPONSE_STYLE_LABELS[style];
}

export const ALL_RESPONSE_STYLES: ResponseStyle[] = [
  'professional',
  'friendly',
  'short',
  'detailed',
  'client-friendly',
  'technical',
  'simple-english',
];
