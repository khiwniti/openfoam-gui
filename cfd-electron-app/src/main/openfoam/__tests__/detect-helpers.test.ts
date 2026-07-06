/**
 * V1.39 — vitest suite for the 4 pure helpers lifted from
 *  src/main/openfoam/detect.ts into
 *  src/main/openfoam/detect-helpers.ts:
 *    * parseOpenfoamVersion — parses the stdout of
 *      `bash -c "set -e; source <bashrc>; echo $WM_PROJECT_VERSION"`
 *      into the OpenFOAM version string (or null if empty).
 *    * parseFoamBinPaths — parses the stdout of
 *      `bash -c "...; echo $FOAM_APPBIN $WM_PROJECT_DIR/platforms/.../bin"`
 *      into the array of bin directory paths.
 *    * formatBashrcProbeCommand — builds the bash -c command
 *      string for the WM_PROJECT_VERSION probe.
 *    * formatBashrcBinPathsCommand — builds the bash -c command
 *      string for the $FOAM_APPBIN + $WM_PROJECT_DIR/platforms/.../bin
 *      probe.
 *
 *  Mirrors the V1.37* / V1.38* test-file structures: pure-fn
 *  tests, no fs, no child_process, no electron. The 4 helpers
 *  are fully string-in / string-out, so the suite exercises
 *  them with canonical inputs + edge cases + the exact
 *  command-shape regression-pins that a future "loosen the
 *  bash quoting" refactor would break.
 */
import { describe, it, expect } from 'vitest';
import {
  formatBashrcBinPathsCommand,
  formatBashrcProbeCommand,
  parseFoamBinPaths,
  parseOpenfoamVersion,
} from '../detect-helpers';

const BASHRC = '/opt/openfoam/etc/bashrc';

describe('parseOpenfoamVersion', () => {
  it("returns the trimmed version string for a clean stdout", () => {
    // The bash -c command ends with `echo "$WM_PROJECT_VERSION"`
    // which adds a trailing newline. The trim() strips it.
    expect(parseOpenfoamVersion('v2412')).toBe('v2412');
    expect(parseOpenfoamVersion('v2412\n')).toBe('v2412');
  });

  it("returns the trimmed version string for trailing whitespace beyond the trailing newline", () => {
    // Defensive: a misconfigured bashrc might echo extra
    //  whitespace (e.g., from a `printf "%s "` call). The
    //  trim() handles all of \n / space / \t / \r.
    expect(parseOpenfoamVersion('v2412   \n')).toBe('v2412');
    expect(parseOpenfoamVersion('\t v2412 \t')).toBe('v2412');
    expect(parseOpenfoamVersion('v2412\r\n')).toBe('v2412');
  });

  it("returns null for an empty stdout (bashrc that doesn't define WM_PROJECT_VERSION)", () => {
    // A bashrc that sources successfully but doesn't set
    //  WM_PROJECT_VERSION (e.g., a user's pre-init script
    //  that aborts the env load) returns an empty stdout.
    //  probeBashrc interprets null as "no detection" and
    //  continues to the next candidate bashrc.
    expect(parseOpenfoamVersion('')).toBe(null);
    expect(parseOpenfoamVersion('\n')).toBe(null);
    expect(parseOpenfoamVersion('   \n  \t  ')).toBe(null);
  });

  it("returns the full string verbatim for OpenFOAM Foundation's 'v' prefix or OpenCFD's bare number", () => {
    // The renderer's OpenfoamDetected.version field surfaces
    //  the raw string verbatim -- the IPC handler doesn't
    //  normalize. Foundation's releases use 'vXXXX' (e.g.,
    //  'v2412'); OpenCFD/ESI's release branches use bare
    //  numbers (e.g., '10' for OpenFOAM 10). Both pass
    //  through unchanged.
    expect(parseOpenfoamVersion('v2412')).toBe('v2412');
    expect(parseOpenfoamVersion('10')).toBe('10');
    expect(parseOpenfoamVersion('2312')).toBe('2312');
  });

  it("preserves internal whitespace (defensive: a malformed version string passes through)", () => {
    // The parser is intentionally permissive -- it doesn't
    //  validate the version string shape. A future "validate
    //  the version format" pass would land as a separate
    //  function (e.g., `isValidVersion(str)`); this parser
    //  remains a thin trim+nullify.
    expect(parseOpenfoamVersion('OpenFOAM-10  \n')).toBe('OpenFOAM-10');
  });
});

describe('parseFoamBinPaths', () => {
  it("returns a 2-element array for the standard $FOAM_APPBIN + $WM_PROJECT_DIR/platforms/.../bin output", () => {
    // The canonical probe output: `$FOAM_APPBIN` (the
    //  application bin, typically
    //  `/opt/openfoam/platforms/linux64GccDPInt32Opt/bin`)
    //  followed by a single space and the explicit
    //  `$WM_PROJECT_DIR/platforms/.../bin` path.
    expect(parseFoamBinPaths(
      '/opt/openfoam/platforms/linux64GccDPInt32Opt/bin /opt/openfoam/platforms/linux64GccDPInt32Opt/bin',
    )).toEqual([
      '/opt/openfoam/platforms/linux64GccDPInt32Opt/bin',
      '/opt/openfoam/platforms/linux64GccDPInt32Opt/bin',
    ]);
  });

  it("strips the trailing newline from the echo output", () => {
    // bash's `echo` adds a trailing \n; the trim() strips it
    //  before the split. The output is identical to the
    //  no-newline case (modulo the \n removal).
    expect(parseFoamBinPaths(
      '/opt/openfoam/platforms/linux64GccDPInt32Opt/bin /opt/openfoam/platforms/linux64GccDPInt32Opt/bin\n',
    )).toEqual([
      '/opt/openfoam/platforms/linux64GccDPInt32Opt/bin',
      '/opt/openfoam/platforms/linux64GccDPInt32Opt/bin',
    ]);
  });

  it("returns a single-element array when only $FOAM_APPBIN is set", () => {
    // A partial OpenFOAM install (e.g., the user sourced the
    //  bashrc but $WM_PROJECT_DIR is unset) produces just
    //  the FOAM_APPBIN line. The parser handles 1-element
    //  output without crashing.
    expect(parseFoamBinPaths('/opt/openfoam/platforms/linux64GccDPInt32Opt/bin\n')).toEqual([
      '/opt/openfoam/platforms/linux64GccDPInt32Opt/bin',
    ]);
  });

  it("returns an empty array for an empty stdout (the catch-all in resolveBinFromBashrc)", () => {
    // If the bashrc source fails mid-way (e.g., a missing
    //  wmake toolchain), the echo may produce an empty
    //  stdout. The parser returns []; resolveBinFromBashrc's
    //  fileExists loop iterates over an empty array and
    //  returns []; detectOpenfoam continues to the next
    //  candidate.
    expect(parseFoamBinPaths('')).toEqual([]);
    expect(parseFoamBinPaths('\n')).toEqual([]);
    expect(parseFoamBinPaths('   \t  ')).toEqual([]);
  });

  it("collapses runs of internal whitespace (defensive: a multi-space separator)", () => {
    // The trim() + \s+ split handles any number of
    //  internal whitespace characters (space / tab / multiple
    //  spaces), not just the canonical single-space
    //  separator. A future "tighten the regex" pass would
    //  break this test intentionally.
    expect(parseFoamBinPaths(
      '/path1   /path2\t/path3\n',
    )).toEqual(['/path1', '/path2', '/path3']);
  });
});

describe('formatBashrcProbeCommand', () => {
  it("builds the canonical set -e + source + echo $WM_PROJECT_VERSION command", () => {
    expect(formatBashrcProbeCommand(BASHRC)).toBe(
      `set -e; source "${BASHRC}" >/dev/null 2>&1; echo "$WM_PROJECT_VERSION"`,
    );
  });

  it("double-quotes the bashrc path (handles paths with spaces)", () => {
    // The OpenFOAM Homebrew installs use
    //  `/opt/homebrew/opt/openfoam/etc/bashrc` (space-free),
    //  but a manual build with a username containing a
    //  space (e.g., `/Users/john doe/OpenFOAM/v2412/etc/bashrc`)
    //  would otherwise split into 2+ bash tokens. The
    //  double-quoting keeps the path atomic.
    expect(formatBashrcProbeCommand('/Users/john doe/OpenFOAM/etc/bashrc')).toBe(
      `set -e; source "/Users/john doe/OpenFOAM/etc/bashrc" >/dev/null 2>&1; echo "$WM_PROJECT_VERSION"`,
    );
  });

  it("pins the source-suppress redirect (`>/dev/null 2>&1`) + `set -e` flag (regression-net)", () => {
    // The `set -e` makes the sub-shell exit immediately on
    //  any error in the source chain (a missing bashrc, a
    //  syntax error, etc.) so the caller sees a non-zero
    //  exit code rather than an empty stdout. The
    //  `>/dev/null 2>&1` suppresses the typical "Loading
    //  OpenFOAM environment..." banner that would otherwise
    //  pollute the execFile stderr stream. A future "loosen
    //  the redirect" pass would break this test
    //  intentionally.
    const cmd = formatBashrcProbeCommand(BASHRC);
    expect(cmd).toContain('set -e');
    expect(cmd).toContain('>/dev/null 2>&1');
    expect(cmd).toContain('echo "$WM_PROJECT_VERSION"');
  });
});

describe('formatBashrcBinPathsCommand', () => {
  it("builds the canonical set -e + source + echo $FOAM_APPBIN + $WM_PROJECT_DIR/platforms/.../bin command", () => {
    expect(formatBashrcBinPathsCommand(BASHRC)).toBe(
      `set -e; source "${BASHRC}" >/dev/null 2>&1; echo "$FOAM_APPBIN $WM_PROJECT_DIR/platforms/$WM_ARCH$WM_COMPILER$WM_PRECISION_OPTION$WM_LABEL_OPTION/bin"`,
    );
  });

  it("quotes the whole echo argument and relies on the literal source-space + JS-level split (not bash word-splitting)", () => {
    // The echo argument is a single double-quoted string
    //  (`echo "$FOAM_APPBIN $WM_PROJECT_DIR/platforms/.../bin"`).
    //  The literal space between the two variable
    //  expansions in the source is preserved through the
    //  double-quote expansion, producing a single stdout
    //  string with one space; `parseFoamBinPaths` splits
    //  on that whitespace at the JS level. There is no
    //  bash-level word-splitting involved. The
    //  double-quoting also defends against FOAM_APPBIN /
    //  WM_PROJECT_DIR values that contain spaces, which
    //  would otherwise word-split the echo argument and
    //  break the parse.
    const cmd = formatBashrcBinPathsCommand(BASHRC);
    expect(cmd).toContain('echo "$FOAM_APPBIN $WM_PROJECT_DIR');
    // The closing `"` is at the very end of the string
    //  (after the literal `/bin`), NOT immediately after
    //  `$WM_LABEL_OPTION/bin`. If a future "loosen the
    //  quoting" pass removed the outer `"..."`, the echo
    //  argument would word-split on any whitespace inside
    //  the variable values (a hypothetical FOAM_APPBIN
    //  like `/opt/foam 10/bin` would split into `/opt/foam`
    //  and `10/bin`, breaking the 2-element parse).
    expect(cmd).not.toContain('"$WM_PROJECT_DIR/platforms/$WM_ARCH$WM_COMPILER$WM_PRECISION_OPTION$WM_LABEL_OPTION/bin"');
  });

  it("uses the same set -e + source-suppress pattern as formatBashrcProbeCommand", () => {
    const cmd = formatBashrcBinPathsCommand(BASHRC);
    expect(cmd).toContain('set -e');
    expect(cmd).toContain('>/dev/null 2>&1');
    expect(cmd).toContain('source "');
  });
});