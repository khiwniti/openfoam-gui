/**
 * V1.37c — vitest suite for the two new pure formatters lifted from
 *  src/main/openfoam/runner.ts into src/main/openfoam/runner-helpers.ts:
 *    * formatBashInvocation — the `source <bashrc> >/dev/null 2>&1 && cd
 *      <caseDir> && <argv...>` bash command builder used by runStage.
 *    * formatTerminalPhase — the terminal-phase selector used by
 *      executeRun's `emitTerminal` to pick 'cancelled' vs 'converged'
 *      + the user-facing message.
 *
 *  Mirrors the V1.37a runner-helpers.test.ts structure: pure-fn
 *  tests, no electron, no fs, no ipcMain. The two helpers here are
 *  fully string-in/string-out, so the suite exercises them with
 *  canonical inputs (simple command, space-bearing arg, embedded
 *  quote, bashrc-with-space) + edge cases (empty command array,
 *  empty contextLabel) + a regression-net test that pins the exact
 *  user-facing message strings (a future "user-friendly" refactor
 *  would change the wording and break these tests, which is
 *  intentional — the wording is part of the public contract that
 *  the renderer's Run panel surfaces verbatim).
 */
import { describe, it, expect } from 'vitest';
import {
  formatBashInvocation,
  formatTerminalPhase,
} from '../runner-helpers';

const BASHRC = '/opt/openfoam/etc/bashrc';
const CASE_DIR = '/home/user/cases/cavity';

describe('formatBashInvocation', () => {
  it('wraps bashrc + caseDir in double quotes and forwards a single-arg command verbatim', () => {
    expect(formatBashInvocation(BASHRC, CASE_DIR, ['blockMesh'])).toBe(
      `source "${BASHRC}" >/dev/null 2>&1 && cd "${CASE_DIR}" && blockMesh`,
    );
  });

  it('joins a multi-arg command with single spaces and no quoting (no space-bearing args)', () => {
    expect(formatBashInvocation(BASHRC, CASE_DIR, ['mpirun', '-np', '4', 'simpleFoam', '-parallel'])).toBe(
      `source "${BASHRC}" >/dev/null 2>&1 && cd "${CASE_DIR}" && mpirun -np 4 simpleFoam -parallel`,
    );
  });

  it('JSON-encodes a single space-bearing arg so the bash string parses back to the same argv', () => {
    expect(formatBashInvocation(BASHRC, CASE_DIR, ['echo', 'hello world'])).toBe(
      `source "${BASHRC}" >/dev/null 2>&1 && cd "${CASE_DIR}" && echo "hello world"`,
    );
  });

  it('JSON-encodes a space-bearing arg that also contains an embedded double quote', () => {
    // JSON.stringify('say "hi"') === '"say \\"hi\\""' (note the escaped backslash + quote).
    //  This is the correct bash-quoting form: when the resulting string
    //  is re-parsed by bash, the backslash escapes are stripped and
    //  the embedded quote is treated as a literal character, not as
    //  a quote terminator.
    expect(formatBashInvocation(BASHRC, CASE_DIR, ['echo', 'say "hi"'])).toBe(
      `source "${BASHRC}" >/dev/null 2>&1 && cd "${CASE_DIR}" && echo "say \\"hi\\""`,
    );
  });

  it('emits an empty trailing `&& ` for an empty command array (caller-side responsibility to not invoke)', () => {
    // The runner never builds an empty stage in practice (buildRunPipeline
    //  always returns at least blockMesh + foamToVTK), but pinning the
    //  behavior guards against a future refactor that introduces an
    //  empty-command short-circuit and accidentally changes the output.
    expect(formatBashInvocation(BASHRC, CASE_DIR, [])).toBe(
      `source "${BASHRC}" >/dev/null 2>&1 && cd "${CASE_DIR}" && `,
    );
  });

  it('handles a bashrc path that itself contains a space (the JSON-quoting is only applied to argv)', () => {
    // Note: bashrc + caseDir are double-quoted via the template-literal
    //  form, which preserves spaces without needing JSON.stringify. The
    //  JSON-quoting is reserved for argv entries, which the runner
    //  treats as opaque values (the user may legitimately have argv
    //  entries with embedded quotes / backticks via the convergence
    //  detector's `stop` callback or future render-time variables).
    const bashrcWithSpace = '/opt/open foam/etc/bashrc';
    expect(formatBashInvocation(bashrcWithSpace, CASE_DIR, ['blockMesh'])).toBe(
      `source "${bashrcWithSpace}" >/dev/null 2>&1 && cd "${CASE_DIR}" && blockMesh`,
    );
  });

  it('handles a caseDir path that itself contains a space', () => {
    const caseDirWithSpace = '/home/user/cases/my cavity';
    expect(formatBashInvocation(BASHRC, caseDirWithSpace, ['blockMesh'])).toBe(
      `source "${BASHRC}" >/dev/null 2>&1 && cd "${caseDirWithSpace}" && blockMesh`,
    );
  });
});

describe('formatTerminalPhase', () => {
  it("returns { phase: 'cancelled', message: 'Run was cancelled' } for reason='user' with empty contextLabel", () => {
    // The pre-loop check in executeRun passes '' as the contextLabel
    //  (no stage has been started yet). Pin the exact user-facing
    //  message wording — the renderer's Run panel surfaces it verbatim
    //  in the "stopped" toast.
    expect(formatTerminalPhase('user', '')).toEqual({
      phase: 'cancelled',
      message: 'Run was cancelled',
    });
  });

  it("returns { phase: 'cancelled', message: 'Run was cancelled during <stage>' } for reason='user' with a contextLabel", () => {
    expect(formatTerminalPhase('user', 'during solving')).toEqual({
      phase: 'cancelled',
      message: 'Run was cancelled during solving',
    });
  });

  it("returns { phase: 'converged', message: 'Solver converged — auto-stopped before endTime' } for reason='converged' with empty contextLabel", () => {
    expect(formatTerminalPhase('converged', '')).toEqual({
      phase: 'converged',
      message: 'Solver converged — auto-stopped before endTime',
    });
  });

  it("returns { phase: 'converged', message: 'Solver converged — auto-stopped during <stage> before endTime' } for reason='converged' with a contextLabel", () => {
    expect(formatTerminalPhase('converged', 'during solving')).toEqual({
      phase: 'converged',
      message: 'Solver converged — auto-stopped during solving before endTime',
    });
  });

  it('pins the exact em-dash in the converged message (U+2014, NOT a hyphen-minus or en-dash)', () => {
    // The em-dash is part of the user-facing copy. A future "fix typo"
    //  pass that swaps the em-dash for a hyphen or an en-dash would
    //  render the toast visually differently and break this test
    //  intentionally.
    const { message } = formatTerminalPhase('converged', '');
    expect(message).toContain('—');
    expect(message).not.toContain(' - ');
    expect(message).not.toContain(' – ');
  });
});
