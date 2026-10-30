/** Phase 15: minimal semver comparison for the update-check architecture —
 * no external dependency, just the 3-part MAJOR.MINOR.PATCH comparison this
 * app actually needs (no pre-release/build-metadata support, since this
 * project's own versioning is plain semver, see CHANGELOG.md). */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

function parseVersion(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
}
