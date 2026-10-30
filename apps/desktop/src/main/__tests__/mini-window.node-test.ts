/**
 * Plain-Node smoke test for apps/desktop/src/main's pure logic: Phase 12's
 * window-geometry functions (dimensionsForMode/clampToVisibleArea/
 * pickDisplay — no Electron needed, deliberately Electron-free, see
 * miniWindowGeometry.ts's own doc comment) and Phase 13's log-scrubbing
 * helper. Everything else in apps/desktop/src/main is real Electron API
 * calls (BrowserWindow/screen/globalShortcut), covered by typecheck + build
 * + manual verification instead (no real display in this sandbox).
 * Run with `pnpm --filter @kvl/desktop test:desktop-main-core`.
 */
import { dimensionsForMode, clampToVisibleArea, pickDisplay, type DisplayInfo, type Rect } from '../miniWindowGeometry';
import { scrubForLog } from '../logScrub';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function display(id: number, x: number, y: number, width: number, height: number, isPrimary = false): DisplayInfo {
  return { id, bounds: { x, y, width, height }, workArea: { x, y, width, height }, isPrimary };
}

// --- dimensionsForMode: 4 distinct, sane sizes ---
{
  const full = dimensionsForMode('full');
  const compact = dimensionsForMode('compact');
  const mini = dimensionsForMode('mini');
  const collapsed = dimensionsForMode('collapsed');

  assert(compact.width === 380 && compact.height === 540, `compact mode keeps Phase 5's original size, got ${compact.width}x${compact.height}`);
  const sizes = [full, compact, mini, collapsed];
  const areas = sizes.map((s) => s.width * s.height);
  assert(new Set(areas).size === 4, 'all 4 modes have distinct areas (no accidental duplicates)');
  assert(areas[0] > areas[1] && areas[1] > areas[2] && areas[2] > areas[3], 'modes shrink in the expected order: full > compact > mini > collapsed');
  assert(collapsed.width <= 80 && collapsed.height <= 80, `collapsed is genuinely tiny, got ${collapsed.width}x${collapsed.height}`);
}

// --- clampToVisibleArea: fully inside a display passes through unchanged ---
{
  const primary = display(1, 0, 0, 1920, 1080, true);
  const bounds: Rect = { x: 100, y: 100, width: 380, height: 540 };
  const result = clampToVisibleArea(bounds, [primary]);
  assert(result.x === 100 && result.y === 100 && result.width === 380 && result.height === 540, `bounds fully inside a display are returned unchanged, got ${JSON.stringify(result)}`);
}

// --- clampToVisibleArea: fully outside every display gets re-centered on primary ---
{
  const primary = display(1, 0, 0, 1920, 1080, true);
  const secondary = display(2, 1920, 0, 1920, 1080, false);
  const bounds: Rect = { x: 5000, y: 5000, width: 380, height: 540 }; // nowhere near either display
  const result = clampToVisibleArea(bounds, [primary, secondary]);
  assert(result.x >= 0 && result.x + result.width <= 1920, `bounds entirely off both displays are re-centered onto the primary display, got ${JSON.stringify(result)}`);
  assert(result.width === 380 && result.height === 540, 'size is preserved when re-centering (it already fit)');
}

// --- clampToVisibleArea: partially off-screen gets nudged fully on-screen ---
{
  const primary = display(1, 0, 0, 1920, 1080, true);
  const bounds: Rect = { x: 1800, y: 1000, width: 380, height: 540 }; // sticks out past the right and bottom edges
  const result = clampToVisibleArea(bounds, [primary]);
  assert(result.x + result.width <= 1920, `right edge is nudged back on-screen, got x=${result.x} width=${result.width}`);
  assert(result.y + result.height <= 1080, `bottom edge is nudged back on-screen, got y=${result.y} height=${result.height}`);
  assert(result.x >= 0 && result.y >= 0, 'nudging never pushes the window past the top-left edge either');
}

// --- clampToVisibleArea: never crashes / mispositions with zero displays ---
{
  const bounds: Rect = { x: 10, y: 10, width: 100, height: 100 };
  const result = clampToVisibleArea(bounds, []);
  assert(result.x === 10 && result.width === 100, 'an empty display list is a no-op (nothing to clamp against)');
}

// --- pickDisplay: all 3 preferences ---
{
  const primary = display(1, 0, 0, 1920, 1080, true);
  const secondary = display(2, 1920, 0, 1920, 1080, false);
  const displays = [primary, secondary];

  assert(pickDisplay(displays, 'primary').id === 1, "'primary' resolves to the primary display");
  assert(pickDisplay(displays, 'secondary').id === 2, "'secondary' resolves to the non-primary display when one exists");
  assert(pickDisplay(displays, 'current', 2).id === 2, "'current' resolves to whichever display matches the given currentDisplayId");
  assert(pickDisplay(displays, 'current', 999).id === 1, "'current' falls back to primary when currentDisplayId matches no known display");
}

// --- pickDisplay: 'secondary' falls back to primary with only one display ---
{
  const onlyPrimary = [display(1, 0, 0, 1920, 1080, true)];
  assert(pickDisplay(onlyPrimary, 'secondary').id === 1, "'secondary' falls back to primary when no second display exists");
}

// --- scrubForLog (Phase 13): redacts key-shaped fields and caps length ---
{
  const withKey = scrubForLog('{"apiKey":"sk-real-secret-value","other":"fine"}');
  assert(!withKey.includes('sk-real-secret-value'), `a real apiKey value never appears in the scrubbed output, got "${withKey}"`);
  assert(withKey.includes('[REDACTED]'), 'the redacted field is replaced with a visible [REDACTED] marker, not silently dropped');
  assert(withKey.includes('"other":"fine"'), 'non-sensitive fields pass through unchanged');

  const withToken = scrubForLog('connect failed, token: "abc123", retrying');
  assert(!withToken.includes('abc123'), 'a token-shaped field is redacted regardless of exact key casing/spacing');

  const longMessage = 'x'.repeat(1000);
  const truncated = scrubForLog(longMessage);
  assert(truncated.length < 1000, `a very long message is truncated, got length ${truncated.length}`);
  assert(truncated.includes('truncated'), 'truncation is visibly marked, not silently cut');

  const plain = scrubForLog('Unhandled server message');
  assert(plain === 'Unhandled server message', 'an ordinary short message with nothing sensitive passes through completely unchanged');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
