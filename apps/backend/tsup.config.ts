import { defineConfig } from 'tsup';

/**
 * Phase 15: a packaged Electron build has no pnpm/tsx toolchain available —
 * it must run this bundle directly under `ELECTRON_RUN_AS_NODE=1`. tsup's
 * CLI auto-externalizes everything in `dependencies` by default (no CLI flag
 * can express a regex noExternal), which previously left all 9 `@kvl/*`
 * workspace packages unbundled — Node then tried to resolve them through the
 * pnpm symlink straight to raw, extensionless-import TypeScript source and
 * failed with ERR_MODULE_NOT_FOUND. `better-sqlite3` is the one dependency
 * that genuinely can't be bundled as JS (native module) — it stays external
 * and ships alongside the bundle as its own real package folder instead (see
 * electron-builder.yml's extraResources).
 *
 * CJS output, not ESM: found for real that bundling `pino` (a CJS package
 * with an internal conditional `require(x)` for its transport machinery)
 * into ESM output throws "Dynamic require ... is not supported" at runtime —
 * esbuild's ESM-target require-interop shim can't handle a non-statically-
 * analyzable require() call. CJS output sidesteps this entirely (`require`
 * stays real Node require, no shim needed) and is otherwise equivalent here
 * — nothing in this backend needs genuine ESM-only syntax. `import.meta.url`
 * in migrate.ts (used to locate the migrations dir) is handled transparently
 * by esbuild's own automatic CJS shim for it, verified by actually booting
 * the migration step below, not assumed.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // tsup auto-externalizes everything listed under package.json's
  // "dependencies" by default (a plugin-level default distinct from the
  // `external` option below) — found for real when a packaged spawn failed
  // with ERR_MODULE_NOT_FOUND on 'pino' even though `external` only ever
  // named better-sqlite3. Every pure-JS dependency needs an explicit
  // noExternal entry to actually get bundled; only better-sqlite3 (a native
  // module) is left as a real external package (see electron-builder.yml's
  // extraResources). pino-pretty is deliberately NOT bundled or shipped —
  // logger.ts only activates its worker-thread transport outside
  // NODE_ENV=production, and the packaged spawn always sets that.
  external: ['better-sqlite3'],
  noExternal: [/^@kvl\//, 'ws', 'pino', 'dotenv', 'zod', 'uuid'],
  // migrate.ts locates its .sql files relative to import.meta.url at
  // runtime — tsup only bundles JS/TS, so the migrations directory has to
  // be copied alongside the single-file bundle explicitly, or a packaged
  // build would ENOENT on its very first boot (found by actually running
  // the bundle, not assumed).
  // `rm -rf` first: `cp -r src dst` copies INTO dst (nesting) if dst already
  // exists, which it does on every build after the first since tsup's own
  // `clean: true` only tracks files it emits itself, not this hook's output
  // — found for real when a second build produced dist/migrations/migrations/*.
  onSuccess: 'rm -rf dist/migrations && cp -r src/db/migrations dist/migrations',
});
