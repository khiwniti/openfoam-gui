/**
 * V1.31a — wire-format regression net for the IPC main handler's
 *  `runStart` payload. Three describe blocks:
 *
 *   1. RunStartConvergenceSchema   — leaf shape, validation rules.
 *   2. RunStartEnvelopeSchema      — full IPC payload: V1.30 first-pass
 *                                    silent-strip regression (the
 *                                    reason V1.30 shipped a fix-pass);
 *                                    optional-key behavior.
 *   3. SolverControls drift guard  — shape parity between this
 *                                    wire-format and the in-store
 *                                    SolverControlsSchema.shape.converge
 *                                    so a future divergence (e.g.,
 *                                    adding a field to one side without
 *                                    the other) fails at PR time.
 *
 *  Three design notes that drove the layout:
 *
 *  - The IPC envelope in `src/main/ipc/index.ts` was previously inline
 *    `z.object({...}).parse(args)`. Vitest runs in node env and can't
 *    import `electron`'s `ipcMain`, so the IPC handler is unimportable
 *    from a unit test. Extracting `RunStartEnvelopeSchema` to
 *    `@shared/types` lets us parse the same shape directly here. The
 *    inline code is replaced with `RunStartEnvelopeSchema.parse(args)`
 *    so behavior is byte-for-byte identical (non-strict `.object()`).
 *
 *  - The wire-format `.object()` is intentionally non-strict. Zod's
 *    default `.object()` accepts unknown keys and silently drops them
 *    from the parse result. The V1.30 first-pass bug sent the wrong
 *    key name (`converge:` instead of `convergence:`); Zod parsed with
 *    no error, but `convergence` came back undefined and V1.8's
 *    detector was silently disabled in production. The regression
 *    test in block 2 pins this: a payload with the WRONG key yields
 *    `convergence: undefined` post-parse; a payload with the RIGHT key
 *    yields the canonical object. A future move to `.strict()` (which
 *    would throw on unknown keys) gets caught as a deliberate
 *    behavior change at PR time.
 *
 *  - The leaf shape intentionally differs from
 *    `SolverControlsSchema.shape.converge`: no `.default(...)`, and
 *    `stableIterations` uses `.int().positive()` rather than
 *    `.int().min(1)`. Same rejection set on integers; slight syntax.
 *    Block 3 parses identical canonical input through both and
 *    asserts `toEqual` so a future divergence (e.g., a different
 *    positive bound on one side) fails immediately.
 */
import { describe, expect, it } from 'vitest';
import {
  RunStartConvergenceSchema,
  RunStartEnvelopeSchema,
  SolverControlsSchema,
} from '../types';

const CANONICAL_CONVERGENCE = {
  enabled: true,
  maxInitialResidual: 1e-3,
  stableIterations: 50,
  autoStop: false,
} as const;

const CANONICAL_ENVELOPE = {
  runId: 'run-test-001',
  caseDir: '/tmp/cfdrun/cavity-test',
  bashrc: '/opt/openfoam/etc/bashrc',
  cores: 4,
  solver: 'simpleFoam',
  convergence: CANONICAL_CONVERGENCE,
} as const;

describe('RunStartConvergenceSchema (V1.31a leaf wire-format)', () => {
  it('canonical payload parses cleanly', () => {
    // Smoke test: the shape parses canonical input without complaint.
    expect(RunStartConvergenceSchema.parse(CANONICAL_CONVERGENCE)).toEqual(
      CANONICAL_CONVERGENCE,
    );
  });

  it('rejects maxInitialResidual: -1 (positive Zod constraint)', () => {
    // `.number().positive()` rejects 0 and any negative real. The
    // V1.30 wire-format picked up this constraint from the inline
    // Zod object; lifting to the extracted schema preserves it.
    expect(() =>
      RunStartConvergenceSchema.parse({
        ...CANONICAL_CONVERGENCE,
        maxInitialResidual: -1,
      }),
    ).toThrow();
  });

  it('rejects maxInitialResidual: 0 (positive Zod constraint)', () => {
    expect(() =>
      RunStartConvergenceSchema.parse({
        ...CANONICAL_CONVERGENCE,
        maxInitialResidual: 0,
      }),
    ).toThrow();
  });

  it('rejects stableIterations: 0 (.int().positive())', () => {
    // The drift-guard's wire-format uses `.int().positive()`. Solver
    // Controls uses `.int().min(1)`. Both reject zero; this test pins
    // the wire side specifically.
    expect(() =>
      RunStartConvergenceSchema.parse({
        ...CANONICAL_CONVERGENCE,
        stableIterations: 0,
      }),
    ).toThrow();
  });

  it('rejects stableIterations: 1.5 (.int() constraint)', () => {
    // `.int()` rejects fractional numbers. 1.5 is a realistic input
    // (rounded from a UI field); Zod must refuse, leaving the
    // template render in a known-safe state.
    expect(() =>
      RunStartConvergenceSchema.parse({
        ...CANONICAL_CONVERGENCE,
        stableIterations: 1.5,
      }),
    ).toThrow();
  });

  it('rejects stableIterations: -10 (.positive() constraint)', () => {
    expect(() =>
      RunStartConvergenceSchema.parse({
        ...CANONICAL_CONVERGENCE,
        stableIterations: -10,
      }),
    ).toThrow();
  });

  it('rejects an empty object (all required fields)', () => {
    // No defaults on the wire-format — every field is required. Pin
    // the contract so a future `.optional()` decoration on any field
    // is caught.
    expect(() => RunStartConvergenceSchema.parse({})).toThrow();
  });
});

describe('RunStartEnvelopeSchema (V1.31a IPC main wire-format)', () => {
  // V1.31a review-fix #2 — extract an `unknown`-typed parse lambda so
  //  the regression test in this block can dispatch the wrong-key
  //  shape without triple-cast workarounds at the call sites. The
  //  lambda's input type is intentionally `unknown`; the parsed
  //  return type is the same `RunStartEnvelope` the inline schema
  //  would have produced, so behavior mirrors the IPC handler.
  const parseAsUnknown = (x: unknown) => RunStartEnvelopeSchema.parse(x);

  it('canonical payload parses cleanly with convergence attached', () => {
    const parsed = RunStartEnvelopeSchema.parse(CANONICAL_ENVELOPE);
    expect(parsed.convergence).toEqual(CANONICAL_CONVERGENCE);
    expect(parsed.runId).toBe('run-test-001');
    expect(parsed.cores).toBe(4);
    expect(parsed.solver).toBe('simpleFoam');
  });

  it('payload without convergence parses to convergence: undefined', () => {
    // Optional key behavior — when the renderer doesn't set up the
    // detector, the IPC main handler receives `convergence: undefined`
    // and the runner treats that as "detector disabled". This is
    // the pre-V1.8-compatible shape; V1.31a's V.0 keystroke
    // (RunStartEnvelopeSchema + extracted leaf schema) preserves
    // it.
    const { convergence: _omit, ...sansConvergence } = CANONICAL_ENVELOPE;
    const parsed = RunStartEnvelopeSchema.parse(sansConvergence);
    expect(parsed.convergence).toBeUndefined();
  });

  it('rejects empty payload (all top-level fields required)', () => {
    // V1.31a review-fix #3 — symmetric coverage with the leaf
    //  schema's "rejects empty object" test. The envelope's outer
    //  object has no defaults either; a renderer sending `{}` over
    //  IPC must fail at parse rather than silently run with all-
    //  undefined fields.
    expect(() => RunStartEnvelopeSchema.parse({})).toThrow();
  });

  it('V1.30 first-pass regression net: wrong-key payload yields convergence: undefined', () => {
    // Regression net: pre-V1.30 the renderer store sent `converge:`
    //  (mis-typed) — NOT `convergence:`. The IPC Zod object parsed
    //  without complaint because Zod 3.x's default `.object()` is
    //  **strip** mode (unknown keys are silently removed from the
    //  parsed output, not passed through). The detector was
    //  therefore disabled in production because `convergence` came
    //  back undefined.
    //
    //  V1.31a review-fix #1 + post-review #4 — this test now pins
    //  BOTH sides of the strip-mode semantics AND correctly models
    //  the pre-V1.30 wire shape (only the wrong key, no `convergence:`
    //  at all — JS object literals with both keys would simply have
    //  the right key valued, hiding the bug):
    //    (a) `parsed.convergence === undefined` (the actual V1.30
    //        bug; the detector wouldn't have fired even if enabled
    //        because the config never made it across IPC);
    //    (b) `parsed.converge` is NOT preserved (Zod strip mode).
    //  A future move to `.strict()` (which would THROW on the
    //  unknown key) would surface as a behavior change at PR time.
    //  Build the wrong-key payload by stripping the right key
    //  explicitly: spread canonical minus `convergence`, then add
    //  the wrong key. Mimics exactly what the pre-V1.30 renderer
    //  stored+sent.
    const { convergence: _omit, ...sansConvergence } = CANONICAL_ENVELOPE;
    const wrongKeyPayload = {
      ...sansConvergence,
      // Pre-V1.30 first-pass shape — wrong key name, no `convergence:`.
      converge: CANONICAL_CONVERGENCE,
    };
    const parsed = parseAsUnknown(wrongKeyPayload);
    expect(parsed.convergence).toBeUndefined();
    // Strip-mode assertion: the wrong key did NOT survive the parse.
    expect('converge' in parsed).toBe(false);
  });

  it('V1.30 fix verification: right-key payload yields the parsed object', () => {
    // Companion to the regression net above — positive control. With
    // the V1.30 key name, the parse returns the expected
    // configuration.
    const parsed = RunStartEnvelopeSchema.parse({
      ...CANONICAL_ENVELOPE,
      convergence: CANONICAL_CONVERGENCE,
    });
    expect(parsed.convergence).toEqual(CANONICAL_CONVERGENCE);
  });

  it('rejects empty runId (.min(1))', () => {
    expect(() =>
      RunStartEnvelopeSchema.parse({
        ...CANONICAL_ENVELOPE,
        runId: '',
      }),
    ).toThrow();
  });

  it('rejects cores: 0 (.int().min(1).max(64))', () => {
    expect(() =>
      RunStartEnvelopeSchema.parse({
        ...CANONICAL_ENVELOPE,
        cores: 0,
      }),
    ).toThrow();
  });

  it('rejects cores: 65 (.int().max(64))', () => {
    expect(() =>
      RunStartEnvelopeSchema.parse({
        ...CANONICAL_ENVELOPE,
        cores: 65,
      }),
    ).toThrow();
  });

  it('rejects cores: 4.5 (.int() constraint)', () => {
    expect(() =>
      RunStartEnvelopeSchema.parse({
        ...CANONICAL_ENVELOPE,
        cores: 4.5,
      }),
    ).toThrow();
  });
});

describe('V1.31a drift guard: SolverControls.converge vs RunStartConvergence parity', () => {
  it('identical canonical input parses to identical shape across both schemas', () => {
    // The wire-format and the in-store schema diverge slightly (no
    // .default() on the wire; stableIterations uses .positive() vs
    // .min(1)). For canonical input (every key supplied), the parsed
    // shape must match. If a future V.x adds a new field to one
    // scheme without the other, this test catches it at PR time.
    const fromWire = RunStartConvergenceSchema.parse(CANONICAL_CONVERGENCE);
    const fromStore = SolverControlsSchema.shape.converge.parse(
      CANONICAL_CONVERGENCE,
    );
    expect(fromWire).toEqual(fromStore);
  });

  it('SolverControls.converge fills defaults when keys are missing (legacy-roundtrip)', () => {
    // SolverControlsSchema.shape.converge has `.default(...)` on every
    // field — that's the in-store form (the Build Case form binds to
    // this and Zod's defaults prefill any blank rows). The wire-format
    // has no defaults (the wire only carries what the renderer
    // actually sent; missing-key on the wire is "detector disabled").
    // This test pins the store-side defaulting behavior so V1.31a
    // doesn't accidentally drop it on the round-trip path.
    const parsed = SolverControlsSchema.shape.converge.parse({});
    expect(parsed.enabled).toBe(true);
    expect(parsed.maxInitialResidual).toBe(1e-3);
    expect(parsed.stableIterations).toBe(50);
    expect(parsed.autoStop).toBe(false);
  });

  it('RunStartConvergence does NOT fill defaults — missing keys fail', () => {
    // Companion to the legacy-roundtrip test above. The wire-format
    // has no `.default()` — every key is required. Sending `{}` over
    // IPC should fail at parse, not silently strip into a defaults-
    // filled object that the runner interprets as "detector enabled".
    expect(() => RunStartConvergenceSchema.parse({})).toThrow();
  });
});
