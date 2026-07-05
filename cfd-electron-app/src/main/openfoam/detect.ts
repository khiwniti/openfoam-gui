/**
 * OpenFOAM detection — finds installed OpenFOAM versions and their bashrc paths.
 * The user can override the path explicitly via settings.
 */
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import type { OpenfoamDetected } from '@shared/types';

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

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function probeBashrc(bashrc: string): Promise<OpenfoamDetected | null> {
  try {
    // Source bashrc in a sub-shell, then print WM_PROJECT_VERSION
    const { stdout } = await execFileAsync('bash', [
      '-c',
      `set -e; source "${bashrc}" >/dev/null 2>&1; echo "$WM_PROJECT_VERSION"`,
    ], { timeout: 15_000 });
    const version = stdout.trim();
    if (!version) return null;

    const binPaths = await resolveBinFromBashrc(bashrc);
    return { found: true, version, bashrc, binPaths };
  } catch {
    return null;
  }
}

async function resolveBinFromBashrc(bashrc: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('bash', [
      '-c',
      `set -e; source "${bashrc}" >/dev/null 2>&1; echo "$FOAM_APPBIN $WM_PROJECT_DIR/platforms/$WM_ARCH$WM_COMPILER$WM_PRECISION_OPTION$WM_LABEL_OPTION/bin"`,
    ], { timeout: 15_000 });
    const parts = stdout.trim().split(/\s+/).filter(Boolean);
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

  for (const candidate of [...CANDIDATE_BASHRC_PATHS, ...CANDIDATE_VERSION_DIRS.map((d) => `${d}/etc/bashrc`)]) {
    if (await fileExists(candidate)) {
      const detected = await probeBashrc(candidate);
      if (detected) return detected;
    }
  }

  return {
    found: false,
    installHints: [
      'OpenFOAM was not detected on this system.',
      'Install OpenFOAM (https://www.openfoam.com or https://openfoam.org) or set a custom bashrc path in Settings.',
      'Common path: /opt/openfoam/etc/bashrc (apt) or /opt/OpenFOAM/OpenFOAM-v2412/etc/bashrc (source build)',
    ],
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
