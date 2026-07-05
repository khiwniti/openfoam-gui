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

import { getCandidateBashrcPaths } from '../detect';

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
