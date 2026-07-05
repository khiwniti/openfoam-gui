/**
 * V1.28 -- module-load guard against the same latent-bug class that
 *  bit V1.27 (InitialConditionsSchema referenced before declared).
 *  The forward-ref sweep confirmed 0 such references remain after
 *  V1.27's fix; this test freezes the invariant so a future lift
 *  that introduces a new schema placement gets caught at test-run
 *  time instead of crashing the renderer mid-build.
 *
 *  V1.28 review-fix round-2: split the export-coverage check into
 *  two shape-discriminated groups, both dynamically derived from
 *  `Object.keys(Types)`. Round-1 used a single filter that pulled
 *  in LES_TURBULENCE_TYPES via a literal-string special case, then
 *  required `.parse` for every member -- which is wrong for const
 *  arrays (they don't expose Zod methods). Round-2 splits:
 *    - SCHEMA_NAMES: `endsWith('Schema')` AND has `.parse` method.
 *    - CONST_ARRAY_NAMES: doesn't end with 'Schema' AND is an Array.
 *  Both are auto-discovery so V.x additions need no test edits.
 *  The redundant `LES_TURBULENCE_TYPES.length === 7` size-lock
 *  was dropped (the V1.27 `toEqual([...])` canonical-order check
 *  already locks length implicitly via array equality).
 */
import * as Types from '../types';
import { describe, expect, it } from 'vitest';

describe('types.ts module loader (V1.28 forward-ref guard)', () => {
  // Shape-discriminated export filters. Both are auto-discovery --
  //  future V.x schemas / const arrays will be covered without any
  //  test edits. The two discriminators are mutually exclusive:
  //  Schema-suffix vs Array.isArray. A type-erase-based runtime
  //  check rounds out both filters (`!== null/undefined` and the
  //  respective Zod / Array shape signals).
  const SCHEMA_NAMES = Object.keys(Types).filter((key) => {
    if (!key.endsWith('Schema')) return false;
    const exported = (Types as Record<string, unknown>)[key];
    return (
      exported !== null &&
      exported !== undefined &&
      typeof (exported as { parse?: unknown }).parse === 'function'
    );
  });

  // Const-array exports (non-Schema-suffixed). Currently only
  //  LES_TURBULENCE_TYPES, but the discriminator self-documents
  //  via `.isArray` so future `as const` string lists (e.g.,
  //  V1.29's hypothetical NEW_CONSTANT_NAME) get auto-covered.
  const CONST_ARRAY_NAMES = Object.keys(Types).filter((key) => {
    if (key.endsWith('Schema')) return false;
    const exported = (Types as Record<string, unknown>)[key];
    return Array.isArray(exported);
  });

  it('every schema-shaped export loads without TDZ-class forward-refs', () => {
    // The IMPORT itself triggers module-load; any forward-ref
    // (a `const X = Y` reference before Y was declared) would
    // throw `ReferenceError: Cannot access 'Y' before initialization`
    // and fail this test before reaching the per-name assertions.
    expect(SCHEMA_NAMES.length).toBeGreaterThan(0);
    for (const name of SCHEMA_NAMES) {
      expect(Types, `module should expose ${name}`).toHaveProperty(name);
      const exported = (Types as Record<string, unknown>)[name];
      expect(exported, `${name} must be defined`).toBeDefined();
      expect(exported, `${name} must not be null`).not.toBeNull();
      expect(
        typeof (exported as { parse?: unknown }).parse,
        `${name} must expose a Zod .parse method`,
      ).toBe('function');
    }
  });

  it('every const-array export is defined and contains string entries', () => {
    // Shape discriminator self-documents: a future `as const`
    // string list is auto-covered. The entry-type check guards
    // against wrapping the const array in something exotic
    // (e.g. a frozen object disguised as an array) -- a future
    // refactor would surface here.
    expect(CONST_ARRAY_NAMES.length).toBeGreaterThan(0);
    for (const name of CONST_ARRAY_NAMES) {
      expect(Types, `module should expose ${name}`).toHaveProperty(name);
      const exported = (Types as Record<string, unknown>)[name];
      expect(Array.isArray(exported), `${name} must be an array`).toBe(true);
      for (const entry of exported as ReadonlyArray<unknown>) {
        expect(typeof entry, `${name} entries should be strings`).toBe('string');
      }
    }
  });

  it('V1.28 ship-state: SolverSchema retains 5 enum options', () => {
    // The 5-solver roster is the canonical V.0 baseline (icoFoam,
    //  simpleFoam, pimpleFoam, potentialFoam, buoyantSimpleFoam).
    //  Bump this assertion when a new solver lands (e.g., V1.29's
    //  interFoam would update this to 6). Marked as a snapshot
    //  so future maintainers treat the failure as a deliberate
    //  cardinality bump signal, not a regression. The size-lock
    //  here is intentional (vs dropping it) because there's no
    //  V1.27 precedent locking the solver count.
    expect(Types.SolverSchema.options.length).toBe(5);
  });

  it('every LES entry is a valid TurbulenceModel enum member (subset check)', () => {
    // Most-resilient invariant: cross-references LES_TURBULENCE_TYPES
    // entries against the TurbulenceModelSchema.options set, so the
    // test passes regardless of how many LES variants exist (V.28 has
    // 7, V.29 might add an 8th without breaking this check). The size
    // itself is locked by the V1.27 canonical-order test (NOT here).
    const turbineOptions = Types.TurbulenceModelSchema.options as ReadonlyArray<string>;
    for (const t of Types.LES_TURBULENCE_TYPES) {
      expect(
        turbineOptions,
        `${t} must be a valid TurbulenceModel enum member`,
      ).toContain(t);
    }
  });
});
