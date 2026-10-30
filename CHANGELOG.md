# Changelog

All notable changes to KVL Live Translator are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] — Phase 15 complete (all 15 phases)

The first full release candidate — every phase of the original roadmap is implemented and verified
to the standard documented in each phase's README section and test report.

### Features

- Real-time audio capture (microphone and/or system audio) with voice activity detection and a
  full/compact/mini/collapsed floating window, always-on-top, opacity, and click-through support.
- Provider-based Speech-to-Text, Translation (Hindi/Hinglish/Simple Hindi/Simple English), and
  "My Response" (Hindi/Hinglish → professional English draft), each with a Local → Free → Paid
  provider fallback chain, confidence-based acceptance, and rate-limit/circuit-breaker health
  tracking.
- Text-to-Speech with a Local (espeak-ng) → Browser (Web Speech) → Cloud fallback chain, voice
  selection, speed/volume control, and virtual-audio-cable routing guidance.
- "What does this mean?" per-sentence explanation, with saved history.
- Smart Meeting Copilot — automatic real-time detection of questions, decisions, action items,
  deadlines, requirements, objections, pricing discussions, technical requirements, follow-ups, and
  client requests, combining a free local detector with batched cloud LLM analysis.
- AI Meeting Summary — an 11-section structured summary, with 7 sections built entirely from
  confirmed Copilot facts (zero AI, structurally accurate) and 4 sections of real LLM synthesis.
  Meeting History screen with export (native PDF/text) and cascade delete.
- Multi-provider cost orchestration: economy/balanced/quality cost modes, a hard monthly budget,
  Local-Only Mode, a shared provider health registry, and a request cache with a bounded size.
- A floating meeting-window overlay independent from the main window's session state, with 10
  global keyboard shortcuts.
- Privacy & security hardening: per-launch WebSocket authentication, IPC argument validation,
  encrypted-at-rest provider API keys, configurable transcript retention, a live Security
  diagnostics screen, and log redaction for secrets.
- Production stability: bounded live-transcript memory for long meetings, crash recovery (detects
  and offers to recover or delete an interrupted session after an unclean shutdown), bounded
  same-device microphone auto-retry, a renderer-observed pipeline-latency dashboard, friendlier
  retryable error toasts, and a database boot-resilience guard.
- A 10-step first-run setup wizard (audio setup, microphone/system-audio tests, language, provider,
  privacy, keyboard shortcuts, and a real test meeting) and a real backend-packaging fix so an
  installed build can run without the development toolchain present.
- Accessibility: a global keyboard-focus outline and `aria-label`s on every icon-only control found
  across the app.

### Security

- Closed a pre-hello WebSocket broadcast-subscription gap that allowed any local process to read
  live meeting content without authentication — fixed with a per-launch token checked at the
  HTTP-upgrade layer, before any message can be sent or received.
- Migration atomicity: a partial migration failure no longer leaves the database permanently
  unrecoverable.
- Constant-time secret comparison (hash-then-`timingSafeEqual`) for the WebSocket auth token.
- Never logs API keys, tokens, secrets, or passwords — regex-based redaction on every console
  message forwarded from the renderer.

### Fixes

- A confidence-scoring bug in the reverse (Hindi→English) translation direction that silently
  under-scored valid phrase matches.
- A `RequestCache` unbounded-memory growth risk, fixed with a hard entry cap.
- A CSP gap that silently blocked the renderer's WebSocket connection in a real browser context
  (present since Phase 1, only surfaced once the app was actually loaded in a browser).
- A `requestId` correlation bug where a summary fetch's reply was silently discarded.
- A real backend-packaging gap: the compiled backend was never actually included in a packaged
  build — fixed by bundling it with `tsup` and spawning it via the app's own Electron binary in
  Node-mode, verified end-to-end against a real `electron-builder`-produced package.

### Known limitations (see the Production Readiness Report in README.md for full detail)

- Code-signing, notarization, and a live update-feed server are not configured — no certificates or
  release infrastructure exist yet.
- Windows and macOS installer builds are untested — this project has only been built and verified
  on Linux; `electron-builder.yml` is configured for all three platforms but only the Linux
  (AppImage) target has been exercised.
- The app icon is a programmatically generated monogram badge, not custom-designed artwork.

## [0.1.0] — Phases 1–14 (development)

Iterative development across Phases 1–14 — architecture and UI shell, audio capture, Speech-to-Text,
Translation, the Live Translator UI, My Response, Text-to-Speech, meeting understanding, the Smart
Meeting Copilot, AI Meeting Summary, cost orchestration, window optimization, security hardening,
and production stability polish. See README.md's per-phase sections for full detail on each.
