/**
 * OpenFOAM detection — finds installed OpenFOAM versions and their bashrc paths.
 * The user can override the path explicitly via settings.
 *
 * V1.39 — pure string parsers + bash command constructors
 *  extracted from the inline probeBashrc / resolveBinFromBashrc
 *  bodies into @main/openfoam/detect-helpers. The orchestration
 *  (execFile + timeout + the fileExists loop) stays in this
 *  file; the lifted helpers are vitest-exercisable without
 *  spawning a real bash subprocess.
 */
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import type { OpenfoamDetected } from '@shared/types';
import {
  formatBashrcBinPathsCommand,
  formatBashrcProbeCommand,
  parseFoamBinPaths,
  parseOpenfoamVersion,
} from './detect-helpers';

const execFileAsync = promisify(execFile);

const CANDIDATE_BASHRC_PATHS = [
  '/usr/lib/openfoam/etc/bashrc',
  '/opt/openfoam/etc/bashrc',
  '/opt/OpenFOAM/OpenFOAM-v2412/etc/bashrc',
  '/opt/OpenFOAM/OpenFOAM-v2312/etc/bashrc',
  '/opt/OpenFOAM/OpenFOAM-v2306/etc/bashrc',
  '/opt/OpenFOAM/OpenFOAM-v2212/etc/bashrc',
  '/opt/OpenFOAM/OpenFOAM-v2206/etc/bashrc',
  '/opt/OpenFOAM/OpenFOAM-v2112/etc/bashrc',
  '/opt/openfoam10/etc/bashrc',
  '/opt/openfoam9/etc/bashrc',
  '/opt/openfoam8/etc/bashrc',
  '/opt/openfoam7/etc/bashrc',
  '/opt/openfoam6/etc/bashrc',
];

const CANDIDATE_VERSION_DIRS = [
  '/usr/lib/openfoam',
  '/opt/openfoam',
  '/opt/OpenFOAM',
];

/**
 * V1.32 — macOS OpenFOAM detection paths.
 *
 * OpenFOAM Foundation / ESI do not ship native macOS binaries; the
 * usual install vectors are:
 *   • Homebrew (`brew install openfoam`) -- provides either the
 *     `/opt/homebrew/...` layout (Apple Silicon) or `/usr/local/...`
 *     (Intel). Both the opt-link and the versioned Cellar subdirs
 *     are probed.
 *   • Manual source build dropped into `$HOME/OpenFOAM/<user>-vXXX/`
 *     (the existing `$HOME/OpenFOAM/<name>/etc/bashrc` scan in
 *     `detectOpenfoam` covers this case).
 *   • `/opt/OpenFOAM/OpenFOAM-vXXXX/etc/bashrc` (a copy of the
 *     Linux layout -- works on macOS too if the user installed by
 *     hand).
 *
 * Docker-on-macOS workflows are intentionally NOT handled here:
 * they need a separate "run in container" driver that does not
 * source a bashrc on the host filesystem, which means a larger
 * rerouting of runner.ts. Out of scope for V1.32.
 *
 * The helper takes `platform` as a defaulted parameter so callers
 * (and tests) can exercise each branch explicitly without mocking
 * `process.platform` -- the runtime caller relies on the default
 * `process.platform` value.
 */
export async function getCandidateBashrcPaths(
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const out: string[] = [...CANDIDATE_BASHRC_PATHS];
  if (platform === 'darwin') {
    // Stable opt-link (one symlink per formula, points at the default
    // version). Apple Silicon and Intel are mutually exclusive on any
    // given machine, so pushing both is safe and cheap.
    out.unshift(
      '/opt/homebrew/opt/openfoam/etc/bashrc',   // Apple Silicon
      '/usr/local/opt/openfoam/etc/bashrc',       // Intel
    );
    // Cellar versioned installs -- Homebrew keeps every formerly
    // installed version on disk by default, so the opt-link alone may
    // miss a pinned / unpinned-to-older version the user expects.
    for (const cellar of [
      '/opt/homebrew/Cellar/openfoam',
      '/usr/local/Cellar/openfoam',
    ]) {
      try {
        const versions = await fs.readdir(cellar);
        for (const v of versions) {
          if (v.startsWith('.')) continue; // skip . and .. and any .DS_Store
          out.push(path.join(cellar, v, 'etc', 'bashrc'));
        }
      } catch {
        // Homebrew root or formula not present -- carry on silently.
      }
    }
  }
  return out;
}

/**
 * V1.33 -- extracted from `detectOpenfoam`'s previously-inline
 *  failure-path `installHints` array so the platform-conditional
 *  macOS guidance lines are unit-testable. Behavior is unchanged:
 *  the runtime caller (`detectOpenfoam`) was already passing
 *  `process.platform` directly into the literal spread; the helper
 *  accepts the same default and the same explicit-param contract
 *  as `getCandidateBashrcPaths` so the two V1.32/V1.33 platform-
 *  aware helpers live next to each other in the file.
 */
export function buildInstallHints(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    'OpenFOAM was not detected on this system.',
    'Install OpenFOAM (https://www.openfoam.com or https://openfoam.org) or set a custom bashrc path in Settings.',
    'Common path: /opt/openfoam/etc/bashrc (apt) or /opt/OpenFOAM/OpenFOAM-v2412/etc/bashrc (source build).',
    // V1.32 -- macOS-specific guidance appended only on darwin so
    //  Linux / Windows users don't see suggestions they can't act
    //  on. The first three lines remain platform-agnostic.
    ...(platform === 'darwin'
      ? [
          'On macOS: `brew install openfoam` (provides /opt/homebrew/opt/openfoam/etc/bashrc on Apple Silicon or /usr/local/opt/openfoam/etc/bashrc on Intel).',
          'Alternatively: build from source into $HOME/OpenFOAM/<user>-vXXX/etc/bashrc.',
        ]
      : []),
  ];
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function probeBashrc(bashrc: string): Promise<OpenfoamDetected | null> {
  try {
    // V1.39 — bash -c command string built by
    //  formatBashrcProbeCommand(bashrc); stdout parsed by
    //  parseOpenfoamVersion(stdout) which returns the trimmed
    //  WM_PROJECT_VERSION (or null if empty). The execFile +
    //  timeout + null-on-throw orchestration stays in this
    //  file; the pure construction + parse steps are vitest-
    //  exercisable in @main/openfoam/detect-helpers.
    const { stdout } = await execFileAsync('bash', [
      '-c',
      formatBashrcProbeCommand(bashrc),
    ], { timeout: 15_000 });
    const version = parseOpenfoamVersion(stdout);
    if (!version) return null;

    const binPaths = await resolveBinFromBashrc(bashrc);
    return { found: true, version, bashrc, binPaths };
  } catch {
    return null;
  }
}

async function resolveBinFromBashrc(bashrc: string): Promise<string[]> {
  try {
    // V1.39 — bash -c command string built by
    //  formatBashrcBinPathsCommand(bashrc); stdout parsed by
    //  parseFoamBinPaths(stdout) which returns the array of
    //  resolved bin paths (trim + split-on-whitespace +
    //  filter-empty). The execFile + timeout + fileExists
    //  filter loop stays in this file.
    const { stdout } = await execFileAsync('bash', [
      '-c',
      formatBashrcBinPathsCommand(bashrc),
    ], { timeout: 15_000 });
    const parts = parseFoamBinPaths(stdout);
    const found: string[] = [];
    for (const p of parts) {
      if (await fileExists(p)) found.push(p);
      // walk parents for a bin dir too
      const parentBin = path.join(p, 'bin');
      if (await fileExists(parentBin)) found.push(parentBin);
    }
    return Array.from(new Set(found));
  } catch {
    return [];
  }
}

/**
 * Probe candidate paths for any installed OpenFOAM.
 * Returns the first one found (deterministic order).
 */
export async function detectOpenfoam(): Promise<OpenfoamDetected> {
  const home = os.homedir();

  // Also probe $HOME/OpenFOAM/<name>/etc/bashrc style user installs
  try {
    const homeOpenfoam = path.join(home, 'OpenFOAM');
    if (await fileExists(homeOpenfoam)) {
      const entries = await fs.readdir(homeOpenfoam);
      for (const e of entries) {
        const candidate = path.join(homeOpenfoam, e, 'etc', 'bashrc');
        if (await fileExists(candidate)) CANDIDATE_BASHRC_PATHS.unshift(candidate);
      }
    }
  } catch {
    /* ignore */
  }

  // V1.32 -- `getCandidateBashrcPaths` adds the macOS Homebrew
  //  routes (Apple Silicon opt-link + Intel opt-link + the
  //  versioned Cellar glob) on `platform === 'darwin'`; on every
  //  other platform the result is identical to the previously-
  //  iterated `CANDIDATE_BASHRC_PATHS` constant. Linux / WSL /
  //  manual-install paths are unchanged.
  const platformCandidates = await getCandidateBashrcPaths();
  for (const candidate of [...platformCandidates, ...CANDIDATE_VERSION_DIRS.map((d) => `${d}/etc/bashrc`)]) {
    if (await fileExists(candidate)) {
      const detected = await probeBashrc(candidate);
      if (detected) return detected;
    }
  }

  return {
    found: false,
    // V1.33 -- the previously-inline 3+2 installHints array moved
    //  to the exported `buildInstallHints(platform)` helper so the
    //  darwin-vs-linux branching is unit-testable without spawning
    //  the full `detectOpenfoam` pipeline. The runtime path is
    //  unchanged (the helper with no arg defaults to
    //  `process.platform`).
    installHints: buildInstallHints(),
  };
}

/** Validate that a specific bashrc path works. */
export async function verifyBashrc(bashrcPath: string): Promise<OpenfoamDetected> {
  if (!(await fileExists(bashrcPath))) {
    return { found: false, installHints: [`No file at ${bashrcPath}`] };
  }
  const detected = await probeBashrc(bashrcPath);
  if (!detected) {
    return { found: false, bashrc: bashrcPath, installHints: [`Could not source ${bashrcPath}`] };
  }
  // V1.29 -- returned `detected` directly (was previously
  //  `{ found: true, ...detected }` which TS2783 flagged as
  //  "found specified more than once"). `probeBashrc` already
  //  stamps `found: true` on success, so the spread was
  //  unnecessary; returning the validated object avoids the
  //  static-analysis collision and the runtime spread cost.
  return detected;
}

// V1.39 — re-export the lifted helpers from
//  @main/openfoam/detect-helpers for backward compat. The 4
//  pure utilities (parseOpenfoamVersion + parseFoamBinPaths +
//  formatBashrcProbeCommand + formatBashrcBinPathsCommand)
//  don't have a pre-V1.39 public name to preserve (they were
//  inlined inside probeBashrc / resolveBinFromBashrc), but the
//  re-export keeps the public surface uniform with the
//  V1.37* / V1.38* / V1.38b pattern (every pure utility
//  in a sibling module is also re-exported from the barrel
//  for callers that prefer the shorter `@main/openfoam/detect`
//  import path).
export {
  formatBashrcBinPathsCommand,
  formatBashrcProbeCommand,
  parseFoamBinPaths,
  parseOpenfoamVersion,
} from './detect-helpers';
