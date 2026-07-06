/**
 * V1.38b — vitest suite for the 2 functions in
 *  src/main/openfoam/case-context.ts (split out of case-helpers
 *  in V1.41):
 *    * resolveTemplatesRoot — V1.18a templates directory
 *      resolver, parameterized on env for testability. Dev
 *      (electron-vite) returns `<cwd>/resources/templates`;
 *      production returns `<resourcesPath>/templates` or
 *      `<cwd>/templates` (the `process.resourcesPath ||
 *      process.cwd()` fallthrough).
 *    * buildRenderContext — V1.38b Handlebars context object
 *      construction. The full `{ domain, bc, refinements,
 *      caseLabel } → Record<string, unknown>` transformation
 *      that `renderCase` passes to every `.hbs` template's
 *      `Handlebars.compile(...)(context)` invocation.
 *
 *  Mirrors the V1.37a/V1.37c test-file structures: pure-fn tests,
 *  no electron, no fs, no Handlebars.
 */
import { describe, it, expect } from 'vitest';
import { buildRenderContext, resolveTemplatesRoot } from '../case-context';
// V1.41 — the Domain fixture lives in a shared test helper
//  (case-test-helpers.ts) so the 3 case-ts test files don't
//  triplicate the 50-line `makeTestDomain` body. Tests
//  override individual fields to exercise the per-solver
//  routing of shouldEmitRelaxationFactors +
//  shouldEmitAdaptiveTimeStep and the snappy-driven `origin` /
//  `bbox` branches of buildRenderContext.
import { makeTestDomain } from './case-test-helpers';

describe('resolveTemplatesRoot', () => {
  it("returns `<cwd>/resources/templates` when nodeEnv === 'development'", () => {
    // In dev (electron-vite), templates live alongside the
    //  project root's `resources/` directory. The exact path
    //  is `path.join(cwd, 'resources', 'templates')`.
    expect(resolveTemplatesRoot({
      nodeEnv: 'development',
      cwd: '/home/user/project',
      resourcesPath: '/should/be/ignored',
    })).toBe('/home/user/project/resources/templates');
  });

  it("returns `<resourcesPath>/templates` in production when resourcesPath is set", () => {
    // electron-vite packages bundle resources under
    //  process.resourcesPath; the templates sit one level
    //  deep at `<resourcesPath>/templates`.
    expect(resolveTemplatesRoot({
      nodeEnv: 'production',
      cwd: '/should/be/ignored',
      resourcesPath: '/app.asar.unpacked',
    })).toBe('/app.asar.unpacked/templates');
  });

  it("falls back to `<cwd>/templates` in production when resourcesPath is undefined", () => {
    // The legacy `process.resourcesPath || process.cwd()`
    //  pattern: if process.resourcesPath is undefined (e.g.,
    //  a misconfigured packaged build or a test env), fall
    //  through to cwd-relative templates.
    expect(resolveTemplatesRoot({
      nodeEnv: 'production',
      cwd: '/home/user/project',
      resourcesPath: undefined,
    })).toBe('/home/user/project/templates');
  });
});

describe('buildRenderContext', () => {
  it("builds a cavity context with the per-template precomputed strings + origin defaults", () => {
    // A stock cavity domain (no origin, no bbox, solver=icoFoam)
    //  gets resolution="20 20 20" (from nx/ny/nz), the
    //  bbox-less locationInMesh fallback at (0.5, 0.5, 0.5)
    //  (from Lx/Ly/Lz / 2), origin/ox/oy/oz all "0", and the
    //  2 emit booleans reflecting icoFoam's transient routing
    //  (relaxationFactors=false, adaptiveTimeStep=false).
    const domain = makeTestDomain({ solver: 'icoFoam' });
    const bc = { velocity: {}, pressure: {} };
    const ctx = buildRenderContext({
      domain,
      bc,
      refinements: {},
      caseLabel: 'cavity-test',
    });
    expect(ctx.resolution).toBe('20 20 20');
    expect(ctx.locationInMesh).toBe('0.5 0.5 0.5');
    expect(ctx.caseLabel).toBe('cavity-test');
    expect(ctx.openfoamVersion).toBe('(detected at run)');
    expect(ctx.patchRefinements).toEqual({});
    expect(ctx.bc).toBe(bc);
    // Domain spread — the template's `{{Lx}}` etc. resolve
    //  directly to the domain field values.
    expect(ctx.Lx).toBe(1);
    expect(ctx.nu).toBe(1e-5);
    expect(ctx.solver).toBe('icoFoam');
    expect(ctx.turbulence).toBe('laminar');
    // Origin defaults to undefined (no origin key on Domain) so
    //  the `ox`/`oy`/`oz` strings read "0" (the ?? 0 fallthrough).
    expect(ctx.origin).toBeUndefined();
    expect(ctx.ox).toBe('0');
    expect(ctx.oy).toBe('0');
    expect(ctx.oz).toBe('0');
    expect(ctx.oxPLx).toBe('1');
    expect(ctx.oyPLy).toBe('1');
    expect(ctx.ozPLz).toBe('1');
    // icoFoam routing — no relaxationFactors block, no
    //  adaptiveTimeStep block (default enabled=false).
    expect(ctx.emitRelaxationFactors).toBe(false);
    expect(ctx.emitAdaptiveTimeStep).toBe(false);
  });

  it("uses bbox centroid for locationInMesh when the domain has a bbox", () => {
    // The snappy-driven (imported) flow uses the bbox centroid
    //  + 1/2 the Lx/Ly/Lz offset as the seed for the
    //  blockMesh. The numbers here are the bbox-center + 0.5
    //  for a 1x1x1 cavity — exact match to the inline
    //  formatLocationInMesh logic.
    const domain = makeTestDomain({
      bbox: {
        min: { x: -0.5, y: -0.5, z: -0.5 },
        max: { x: 0.5, y: 0.5, z: 0.5 },
      },
    });
    const ctx = buildRenderContext({
      domain,
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'snappy-test',
    });
    expect(ctx.locationInMesh).toBe('0 0 0');
  });

  it("propagates a custom origin to the 6 origin-coordinate strings", () => {
    // The blockMesh origin (corner offset from the world
    //  origin) is on the domain; the context exposes both
    //  the raw `origin` object (for the template to read
    //  `{{origin.x}}`) and 6 precomputed string forms (ox,
    //  oy, oz, oxPLx, oyPLy, ozPLz) for direct emission in
    //  the .hbs file.
    const domain = makeTestDomain({
      origin: { x: 10, y: 20, z: 30 },
      Lx: 2, Ly: 3, Lz: 4,
    });
    const ctx = buildRenderContext({
      domain,
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'offset-test',
    });
    expect(ctx.origin).toEqual({ x: 10, y: 20, z: 30 });
    expect(ctx.ox).toBe('10');
    expect(ctx.oy).toBe('20');
    expect(ctx.oz).toBe('30');
    expect(ctx.oxPLx).toBe('12');
    expect(ctx.oyPLy).toBe('23');
    expect(ctx.ozPLz).toBe('34');
  });

  it("routes pimpleFoam + relaxationFactors.enabled=true to emitRelaxationFactors=true", () => {
    // pimpleFoam gates the relaxationFactors block on the
    //  per-solver toggle. Default false → no emit. Flip to
    //  true → emit. This pins the routing without coupling
    //  the test to the shouldEmitRelaxationFactors helper's
    //  internal logic.
    const ctx = buildRenderContext({
      domain: makeTestDomain({ solver: 'pimpleFoam' }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'pimple-default',
    });
    expect(ctx.emitRelaxationFactors).toBe(false);

    const ctxEnabled = buildRenderContext({
      domain: makeTestDomain({
        solver: 'pimpleFoam',
        relaxationFactors: { enabled: true, fields: {}, equations: {} },
      }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'pimple-enabled',
    });
    expect(ctxEnabled.emitRelaxationFactors).toBe(true);
  });

  it("routes icoFoam + adaptiveTimeStep.enabled=true to emitAdaptiveTimeStep=true", () => {
    // icoFoam honors the enabled flag (transient solver).
    //  Default false → no emit. Flip to true → emit.
    const ctx = buildRenderContext({
      domain: makeTestDomain({ solver: 'icoFoam' }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'ico-default',
    });
    expect(ctx.emitAdaptiveTimeStep).toBe(false);

    const ctxEnabled = buildRenderContext({
      domain: makeTestDomain({
        solver: 'icoFoam',
        adaptiveTimeStep: { enabled: true, maxCo: 0.5 },
      }),
      bc: { velocity: {}, pressure: {} },
      refinements: {},
      caseLabel: 'ico-enabled',
    });
    expect(ctxEnabled.emitAdaptiveTimeStep).toBe(true);
  });
});
