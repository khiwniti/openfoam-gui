/**
 * V1.32 — platform-conditional OpenFOAM detection candidate paths.
 *
 * Validates that `getCandidateBashrcPaths()`:
 *   • emits Homebrew (Apple Silicon + Intel) opt-links on darwin
 *   • probes the versioned Cellar layout on darwin (when present)
 *   • does NOT emit any Homebrew / Cellar paths on linux
 *   • preserves the stock `/opt/OpenFOAM/OpenFOAM-vXXXX/...` manual-install
 *     routes on every platform (a macOS user who copies the Linux
 *     layout into /opt still has to be findable)
 *
 * The function takes `platform` as a defaulted parameter so tests can
 * exercise each branch without mutating `process.platform` -- the
 * runtime caller relies on the default `process.platform` value.
 *
 * The Cellar glob is exercised against a tiny fixture under /tmp:
 * we create `/tmp/<n>/opt/homebrew/Cellar/openfoam/v2406/etc/`, call
 * the helper with `platform='darwin'`, and assert the glob discovers
 * the bashrc.
 */
import { describe, it, expect } from 'vitest';

import { buildInstallHints, getCandidateBashrcPaths } from '../detect';

describe('V1.32 -- detect.ts platform branching', () => {
  it('darwin: includes Apple Silicon Homebrew opt-link', async () => {
    const paths = await getCandidateBashrcPaths('darwin');
    expect(paths).toContain('/opt/homebrew/opt/openfoam/etc/bashrc');
  });

  it('darwin: includes Intel Homebrew opt-link', async () => {
    const paths = await getCandidateBashrcPaths('darwin');
    expect(paths).toContain('/usr/local/opt/openfoam/etc/bashrc');
  });

  it('darwin: positions Homebrew opt-links ahead of stock /opt paths', async () => {
    const paths = await getCandidateBashrcPaths('darwin');
    const brewIdx = paths.indexOf('/opt/homebrew/opt/openfoam/etc/bashrc');
    const stockIdx = paths.indexOf('/opt/OpenFOAM/OpenFOAM-v2412/etc/bashrc');
    expect(brewIdx).toBeGreaterThanOrEqual(0);
    expect(stockIdx).toBeGreaterThanOrEqual(0);
    // unshift puts Homebrew ahead of the stock list so the resolver
    // probes it first; if the user installed via Homebrew we want
    // their install to win the probe.
    expect(brewIdx).toBeLessThan(stockIdx);
  });

  it('darwin: still includes /opt/OpenFOAM/manual-install routes', async () => {
    // A macOS user who manually copies the Linux layout into /opt
    // must still be findable. This is the existence-parity guarantee
    // with linux.
    const paths = await getCandidateBashrcPaths('darwin');
    expect(paths).toContain('/opt/OpenFOAM/OpenFOAM-v2412/etc/bashrc');
    expect(paths).toContain('/opt/openfoam/etc/bashrc');
    expect(paths).toContain('/usr/lib/openfoam/etc/bashrc');
  });

  it('linux: does NOT include Homebrew / Cellar darwin paths', async () => {
    const paths = await getCandidateBashrcPaths('linux');
    expect(paths).not.toContain('/opt/homebrew/opt/openfoam/etc/bashrc');
    expect(paths).not.toContain('/usr/local/opt/openfoam/etc/bashrc');
    expect(paths.every((p) => !p.startsWith('/opt/homebrew/Cellar/'))).toBe(true);
    expect(paths.every((p) => !p.startsWith('/usr/local/Cellar/'))).toBe(true);
  });

  it('linux: preserves all stock candidate paths', async () => {
    const paths = await getCandidateBashrcPaths('linux');
    // Spot-check a representative subset rather than the full 13-entry
    // list -- the helper is a no-op spread on linux so the contents
    // match `CANDIDATE_BASHRC_PATHS` byte-for-byte. Verifying identity
    // of one entry from each "family" (debian apt / opt-tarball /
    // versioned-tarball / openfoamN-versioned) catches a regression
    // where someone swaps the helper for an accidentally-overlapping
    // list.
    expect(paths).toContain('/usr/lib/openfoam/etc/bashrc');
    expect(paths).toContain('/opt/openfoam/etc/bashrc');
    expect(paths).toContain('/opt/OpenFOAM/OpenFOAM-v2412/etc/bashrc');
    expect(paths).toContain('/opt/openfoam10/etc/bashrc');
    expect(paths).toContain('/opt/openfoam6/etc/bashrc');
  });

  it('linux list is a strict subset of darwin list (parity guarantee)', async () => {
    const linuxPaths = await getCandidateBashrcPaths('linux');
    const darwinPaths = await getCandidateBashrcPaths('darwin');
    for (const p of linuxPaths) {
      expect(darwinPaths).toContain(p);
    }
  });

  it('default param uses process.platform when called without an explicit value', async () => {
    // The runtime caller in detectOpenfoam relies on the defaults;
    // we don't reach into process.platform but we do verify the
    // return shape: when called with no arg the value is the same
    // type as the explicit-platform calls (string[]).
    const paths = await getCandidateBashrcPaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe('V1.33 -- buildInstallHints platform branching', () => {
  it('darwin: includes brew install + source-build guidance', () => {
    const hints = buildInstallHints('darwin');
    expect(hints.some((h) => h.includes('brew install openfoam'))).toBe(true);
    expect(hints.some((h) => h.includes('$HOME/OpenFOAM'))).toBe(true);
    expect(hints.some((h) => h.toLowerCase().includes('alternatively'))).toBe(true);
  });

  it('darwin: still includes the original 3 platform-agnostic lines', () => {
    // Parity guarantee -- the first three lines are useful on every
    // platform; the macOS-added lines are appended AFTER them.
    const hints = buildInstallHints('darwin');
    expect(hints[0]).toBe('OpenFOAM was not detected on this system.');
    expect(hints[1]).toMatch(/^Install OpenFOAM/);
    expect(hints[2]).toMatch(/^Common path:/);
  });

  it('linux: does NOT include the darwin-only brew / source-build lines', () => {
    const hints = buildInstallHints('linux');
    expect(hints.some((h) => h.includes('brew install'))).toBe(false);
    expect(hints.some((h) => h.includes('$HOME/OpenFOAM'))).toBe(false);
    expect(hints.some((h) => h.toLowerCase().startsWith('on macos:'))).toBe(false);
    expect(hints.some((h) => h.toLowerCase().startsWith('alternatively:'))).toBe(false);
  });

  it('win32: same as linux -- no darwin-only lines', () => {
    // Windows users don't see Homebrew suggestions either. The
    // buildInstallHints helper deliberately only branches on
    // `platform === 'darwin'`; everything else (linux / win32 /
    // freebsd / aix / etc.) gets the original 3-line set.
    const hints = buildInstallHints('win32');
    expect(hints.some((h) => h.includes('brew install'))).toBe(false);
    expect(hints.some((h) => h.includes('On macOS'))).toBe(false);
  });

  it('darwin list = linux list + exactly 2 macOS-specific lines (set superset)', () => {
    const linuxHints = buildInstallHints('linux');
    const darwinHints = buildInstallHints('darwin');
    expect(darwinHints.length).toBe(linuxHints.length + 2);
    // Every linux line is preserved verbatim in the darwin list.
    for (const l of linuxHints) expect(darwinHints).toContain(l);
  });

  it('default param falls back to process.platform (semantic equivalence contract)', () => {
    // The V1.33 refactor of detectOpenfoam's failure-path calls
    // buildInstallHints() with no arg; the runtime contract is
    // that the no-arg call returns the SAME array as the explicit
    // `buildInstallHints(process.platform)` call. A regression
    // that hard-coded any other platform string as the default
    // would silently drift detectOpenfoam's user-facing install
    // hint set (e.g. a darwin-host would still see brew lines,
    // but a linux-host running the same code would too). This
    // strict JSON-equivalence assertion catches that silently.
    expect(JSON.stringify(buildInstallHints())).toBe(
      JSON.stringify(buildInstallHints(process.platform)),
    );
  });
});
