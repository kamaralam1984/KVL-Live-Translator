import { app } from 'electron';
import { compareSemver } from '@kvl/shared';

/**
 * Phase 15: real update-check architecture — the plumbing (state machine,
 * semver comparison, timeout/error handling) is real and working; the
 * actual feed URL is a documented placeholder, since no release
 * infrastructure (GitHub Releases, a real update server) exists yet for
 * this project. Never fabricates a fake "up to date" result against a feed
 * that doesn't exist — a fetch failure or an unconfigured feed both
 * surface honestly as 'error', not silently coerced into 'up-to-date'.
 */
export type UpdateStatus = 'checking' | 'up-to-date' | 'update-available' | 'error';

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  message?: string;
}

// TODO before a real release: point this at a real GitHub Releases API URL
// (e.g. https://api.github.com/repos/<owner>/<repo>/releases/latest) or a
// real update-server endpoint returning { version: string }. Left as an
// obviously-fake placeholder host on purpose — better to fail loudly with a
// clear 'error' status than to silently report false confidence.
const UPDATE_FEED_URL = 'https://updates.example-not-configured.invalid/kvl-live-translator/latest.json';
const FETCH_TIMEOUT_MS = 8_000;

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(UPDATE_FEED_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return { status: 'error', currentVersion, message: `Update feed returned HTTP ${response.status}.` };
    }

    const data = (await response.json()) as { version?: unknown };
    if (typeof data.version !== 'string') {
      return { status: 'error', currentVersion, message: 'Update feed response was missing a version field.' };
    }

    const comparison = compareSemver(data.version, currentVersion);
    return comparison > 0
      ? { status: 'update-available', currentVersion, latestVersion: data.version }
      : { status: 'up-to-date', currentVersion, latestVersion: data.version };
  } catch (error) {
    // No real release feed is configured yet (see UPDATE_FEED_URL above) —
    // this is the expected, honest path today, not a bug to hide.
    return { status: 'error', currentVersion, message: error instanceof Error ? error.message : String(error) };
  }
}
