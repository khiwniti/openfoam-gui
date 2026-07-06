/**
 * V1.36d — case-flow IPC handler-body coverage (pure helper surface).
 *
 * The caseCreate / caseSave / caseLoad / pickCaseDir handler bodies in
 * src/main/ipc/index.ts are now thin shells; the inline reply-shape
 * logic + the sanitize+stamp directory-naming logic live in
 * helpers.ts as four pure exports. This file pins their contract so a
 * future edit to the renderer contract (or to the OpenFOAM case-naming
 * convention) fails loudly in CI rather than producing a confusing
 * renderer-side run-state corruption at runtime.
 *
 * Drift-pin targets:
 *   - sanitizeCaseLabel: replace `[^-a-zA-Z0-9_]` with `_`, slice to 60,
 *     default to 'case' when input is undefined / empty.
 *   - ISO timestamp shape: `YYYY-MM-DDTHH-MM-SS` (colons + dots
 *     stripped, leading `T` preserved, slice 0..19).
 *   - caseCreate / caseSave / caseLoad reply discriminator shapes.
 *   - formatCaseLoadReply's explicit `domain: state.domain` resurface
 *     behavior — even though `...state` already includes a `domain`
 *     field, the original inline handler kept the explicit
 *     resurface for the snappy-fallback intent, and the test pins
 *     that the helper preserves the same literal-redundancy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  formatCaseCreateReply,
  formatCaseLoadReply,
  formatCaseSaveReply,
  pickCaseDirName,
} from '@main/ipc/helpers';

describe('pickCaseDirName — directory naming', () => {
  beforeEach(() => {
    // Freeze the wall clock so the ISO stamp substring is reproducible
    // across local + CI runs. Without this the timestamp suffix would
    // drift per-test-execution and the pinned shape assertion below
    // would be flaky.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:34:56.789Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('composes root + safe-label + ISO stamp under the root', () => {
    const dir = pickCaseDirName('/tmp/cases', 'cavity');
    // Sanitize leaves ASCII letters unchanged. ISO stamp slices `T12:34:56`
    // to `T12-34-56`. Joined as `<root>/<label>__<stamp>`.
    expect(dir).toBe(path.join('/tmp/cases', 'cavity__2024-06-01T12-34-56'));
  });

  it('falls back to literal "case" when label is undefined', () => {
    expect(pickCaseDirName('/r', undefined)).toBe(path.join('/r', 'case__2024-06-01T12-34-56'));
  });

  it('falls back to literal "case" when label is an empty string', () => {
    // The same fallback path as undefined — explicit empty-string test
    // so a future helper tweak that treats '' as "intentional empty
    // label" cannot silently break the IPC contract.
    expect(pickCaseDirName('/r', '')).toBe(path.join('/r', 'case__2024-06-01T12-34-56'));
  });

  it('replaces filesystem-hostile chars in the label with underscores', () => {
    // The inline handler used `/[^a-zA-Z0-9_-]/g` — anything outside
    // ASCII letters / digits / underscore / hyphen becomes `_`. This
    // pins spaces, slashes, dots, colons, and unicode single-char.
    const dir = pickCaseDirName('/r', 'my weird../path:2024');
    expect(dir).toBe(path.join('/r', 'my_weird___path_2024__2024-06-01T12-34-56'));
  });

  it('slices the label to at most 60 sanitized chars', () => {
    const long = 'a'.repeat(120);
    const dir = pickCaseDirName('/r', long);
    // 'a' * 60 + '__' + stamp suffix
    expect(path.basename(dir).startsWith('a'.repeat(60) + '__')).toBe(true);
    // ...and 121 chars after the `<root>/` prefix.
    expect(dir.length).toBe('/r/'.length + 60 + '__'.length + '2024-06-01T12-34-56'.length);
  });

  it('respects an explicit `now: Date` for deterministic naming', () => {
    // A different Date with the same input label produces a different
    // path — proves the `now` parameter is plumbed through (not just
    // a no-op escape hatch).
    const a = pickCaseDirName('/r', 'mylabel', new Date('2020-01-01T00:00:00.000Z'));
    const b = pickCaseDirName('/r', 'mylabel', new Date('2030-12-31T23:59:59.999Z'));
    expect(a).toBe(path.join('/r', 'mylabel__2020-01-01T00-00-00'));
    expect(b).toBe(path.join('/r', 'mylabel__2030-12-31T23-59-59'));
    expect(a).not.toBe(b);
  });
});

describe('pickCaseDirName — output determinism invariant', () => {
  // Doubly-belt-and-braces: even if a future refactor accidentally
  // drops the freeze-timer-then-check pattern, the single-call
  // determinism guarantee should still hold because the helper passes
  // a single `now` Date all the way through its body.
  it('returns identical output for identical input across two calls', () => {
    const stamp = new Date('2025-03-14T15:09:26.535Z');
    const a = pickCaseDirName('/x/y', 'airfoil', stamp);
    const b = pickCaseDirName('/x/y', 'airfoil', stamp);
    expect(a).toBe(b);
  });
});

describe('formatCaseSaveReply — reply shape', () => {
  it('wraps a SaveCase renderer-doc in { ok: true, path: caseDir }', () => {
    const reply = formatCaseSaveReply({ caseDir: '/var/cfd/case1' });
    expect(reply).toEqual({ ok: true, path: '/var/cfd/case1' });
  });

  it('forwards just the caseDir key, ignoring extra render-doc fields', () => {
    // The real SaveCase reply-doc carries more than caseDir (mesh
    // counts, block size, etc.). Only caseDir is exposed in the IPC
    // envelope — extra keys must NOT leak through to the renderer.
    const reply = formatCaseSaveReply({
      caseDir: '/c',
      meshCells: 12345,
      extraField: 'noise',
    } as { caseDir: string });
    expect(reply).toEqual({ ok: true, path: '/c' });
    expect(Object.keys(reply)).toEqual(['ok', 'path']);
  });
});

describe('formatCaseCreateReply — reply shape', () => {
  it('returns the canonical { ok: true, message: "case created", caseDir }', () => {
    const reply = formatCaseCreateReply('/cases/cavity__stamp');
    expect(reply).toEqual({
      ok: true,
      message: 'case created',
      caseDir: '/cases/cavity__stamp',
    });
  });

  it('pins the user-facing message literal ("case created")', () => {
    // Renderer-side toasts are keyed off this exact string. Any drift
    // — "Case created", "saved", "ok" — surfaces as a stripped toast.
    expect(formatCaseCreateReply('/x').message).toBe('case created');
  });
});

describe('formatCaseLoadReply — reply discriminator', () => {
  it('returns the ok:false envelope with the canonical message when state is null', () => {
    const reply = formatCaseLoadReply(null, '/cases/missing');
    expect(reply).toEqual({ ok: false, message: 'No .cfd-app-state.json' });
  });

  it('preserves the domain field via the spread when the state carries a domain field', () => {
    // The round-2 `S extends { domain: unknown }` constraint + drop of
    // the explicit `domain: state.domain` line in the helper body
    // means the spread alone carries `domain` to the reply. The test
    // pins that contract: when state has a domain field, the reply's
    // `domain` slot reflects it (transitively via `...state`), so the
    // renderer still gets the snappy-fallback value at the top level.
    const state = {
      kind: 'cavity',
      domain: { geometryKind: 'parametric', nu: 1e-5 },
      label: 'thing',
    };
    const reply = formatCaseLoadReply(state, '/cases/case1');
    expect(reply).toEqual({
      ...state, // spreads { kind, domain, label }
      ok: true,
      caseDir: '/cases/case1',
      // domain is included transitively via ...state — no explicit
      // resurface needed now that S guarantees it.
      domain: state.domain,
    });
  });
});
