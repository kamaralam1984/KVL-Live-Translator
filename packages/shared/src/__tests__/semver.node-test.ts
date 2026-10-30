/**
 * Plain-Node smoke test for compareSemver — pure, DOM-free.
 * Run with `pnpm --filter @kvl/shared test:semver-core`.
 */
import { compareSemver } from '../semver';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

assert(compareSemver('1.0.0', '1.0.0') === 0, 'identical versions compare equal');
assert(compareSemver('2.0.0', '1.0.0') === 1, 'a greater major version compares greater');
assert(compareSemver('1.0.0', '2.0.0') === -1, 'a lesser major version compares lesser');
assert(compareSemver('1.2.0', '1.1.0') === 1, 'a greater minor version compares greater (same major)');
assert(compareSemver('1.1.0', '1.2.0') === -1, 'a lesser minor version compares lesser (same major)');
assert(compareSemver('1.0.2', '1.0.1') === 1, 'a greater patch version compares greater (same major.minor)');
assert(compareSemver('1.0.1', '1.0.2') === -1, 'a lesser patch version compares lesser (same major.minor)');
assert(compareSemver('2.0.0', '1.9.9') === 1, 'major version outweighs a lower minor/patch');
assert(compareSemver('1.9.9', '2.0.0') === -1, 'major version outweighs a higher minor/patch on the other side');
assert(compareSemver('10.0.0', '9.0.0') === 1, 'multi-digit version parts compare numerically, not lexicographically');
assert(compareSemver('1.0', '1.0.0') === 0, 'a missing patch part defaults to 0');

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
