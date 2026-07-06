/**
 * V1.39 — pure string parsers + bash command constructors
 *  extracted from src/main/openfoam/detect.ts.
 *
 * Mirrors the V1.37* / V1.38* lift pattern: the detect.ts
 * barrel co-locates impure orchestration (execFile wrappers,
 * fs.access probes, the detectOpenfoam pipeline) with small
 * pure string-construction + string-parsing helpers. V1.39
 * lifts the pure pieces so vitest can exercise them directly
 * without spawning a real bash subprocess.
 *
 * IPC contract: every helper here is a pure `string → string`
 *  or `string → string[]` transformation. No fs / child_process
 *  / process-spawning. The detect.ts consumer wraps the
 *  returned values in `execFileAsync('bash', ['-c', cmd], …)`
 *  for the command constructors, and feeds the
 *  `execFileAsync` stdout to the parsers.
 *
 * Diff-safe: the lifted functions preserve the inline behavior
 *  byte-for-byte (same trim, same split regex, same bash
 *  command template). detect.ts's probeBashrc and
 *  resolveBinFromBashrc keep their execFile + timeout
 *  orchestration; only the inline pure logic is delegated.
 */

/**
 * V1.39 — parse the stdout of `bash -c "set -e; source
 *  <bashrc> >/dev/null 2>&1; echo $WM_PROJECT_VERSION"` into
 *  the OpenFOAM version string (e.g. `"v2412"` or `"10"`).
 *
 *  Lifted from the inline `const version = stdout.trim();
 *  if (!version) return null;` in detect.ts's probeBashrc.
 *  The trim() removes trailing newlines (bash's `echo` adds
 *  one); the `|| null` coalesce converts the empty-string
 *  case (e.g., a bashrc that sources successfully but
 *  doesn't define WM_PROJECT_VERSION) into a `null` that
 *  probeBashrc interprets as "no detection".
 *
 *  Pure (no I/O, no parsing of OpenFOAM's own semver — the
 *  caller stores the raw string in the OpenfoamDetected
 *  object's `version` field and surfaces it verbatim to the
 *  renderer).
 */
export function parseOpenfoamVersion(stdout: string): string | null {
  const version = stdout.trim();
  return version || null;
}

/**
 * V1.39 — parse the stdout of `bash -c "set -e; source
 *  <bashrc> >/dev/null 2>&1; echo $FOAM_APPBIN
 *  $WM_PROJECT_DIR/platforms/.../bin"` into the list of bin
 *  directory paths that the bashrc-sourced shell resolved.
 *
 *  Lifted from the inline `const parts =
 *  stdout.trim().split(/\s+/).filter(Boolean);` in
 *  detect.ts's resolveBinFromBashrc. The trim() handles the
 *  trailing newline, the `\s+` split handles the 2-space
 *  separator between FOAM_APPBIN and the platforms/.../bin
 *  path, and the `filter(Boolean)` strips empty entries
 *  (defensive: a trailing space would otherwise produce a
 *  spurious empty string in the array).
 *
 *  Pure. The returned array is then post-processed by
 *  resolveBinFromBashrc's fs.access loop to filter for
 *  directories that actually exist on disk (the bashrc
 *  output may include paths that aren't present in a
 *  partial install).
 */
export function parseFoamBinPaths(stdout: string): string[] {
  return stdout.trim().split(/\s+/).filter(Boolean);
}

/**
 * V1.39 — build the bash -c command string that probeBashrc
 *  passes to `execFile('bash', ['-c', cmd], …)`. The command
 *  sources the user-supplied bashrc (suppressing the typical
 *  "Loading OpenFOAM environment..." banner with `>/dev/null
 *  2>&1`), then echoes the resolved $WM_PROJECT_VERSION
 *  variable. The `set -e` flag makes the sub-shell exit
 *  immediately on any error in the source chain (a missing
 *  bashrc, a syntax error, etc.) so the caller sees a
 *  non-zero exit code rather than an empty stdout.
 *
 *  Lifted from the inline template literal in probeBashrc.
 *  The bashrc path is double-quoted to handle paths with
 *  spaces (the OpenFOAM Homebrew installs use
 *  `/opt/homebrew/opt/openfoam/etc/bashrc` which is space-
 *  free, but `/opt/OpenFOAM/<user>-v2412/etc/bashrc` from a
 *  manual build may have a username with a space). The
 *  echo's variable is also double-quoted to prevent
 *  word-splitting on the version string.
 */
export function formatBashrcProbeCommand(bashrc: string): string {
  return `set -e; source "${bashrc}" >/dev/null 2>&1; echo "$WM_PROJECT_VERSION"`;
}

/**
 * V1.39 — build the bash -c command string that
 *  resolveBinFromBashrc passes to `execFile`. The command
 *  sources the user-supplied bashrc, then echoes the
 *  resolved `$FOAM_APPBIN` + a single space + the resolved
 *  `$WM_PROJECT_DIR/platforms/$WM_ARCH$WM_COMPILER$WM_PRECISION_OPTION$WM_LABEL_OPTION/bin`
 *  path. The output is parsed by `parseFoamBinPaths` (above)
 *  via `.trim().split(/\s+/).filter(Boolean)` to recover the
 *  two paths.
 *
 *  Lifted from the inline template literal in
 *  resolveBinFromBashrc. Same `set -e` + source-suppress
 *  pattern as `formatBashrcProbeCommand`. The echo argument
 *  is a single double-quoted string
 *  (`"\"$FOAM_APPBIN $WM_PROJECT_DIR/platforms/.../bin\""`):
 *  the literal space between the two variable expansions in
 *  the source is preserved through the double-quote
 *  expansion, producing a single stdout string with one
 *  space; `parseFoamBinPaths` splits on that whitespace at
 *  the JS level to recover the 2-element array. (The
 *  double-quoting also defends against FOAM_APPBIN / WM_PROJECT_DIR
 *  values that contain spaces, which would otherwise
 *  word-split the echo argument and break the parse.)
 */
export function formatBashrcBinPathsCommand(bashrc: string): string {
  return `set -e; source "${bashrc}" >/dev/null 2>&1; echo "$FOAM_APPBIN $WM_PROJECT_DIR/platforms/$WM_ARCH$WM_COMPILER$WM_PRECISION_OPTION$WM_LABEL_OPTION/bin"`;
}
