/**
 * V1.35b — coverage closure on `buildTemplateLayout(domain, kind)` in case.ts.
 *
 * `buildTemplateLayout` is the .hbs template-orchestration switch in
 * case.ts: given a Domain + CaseKind it returns the ordered list of
 * `TemplateEntry` records that `renderCase` will compile + write to
 * disk. It branches on:
 *
 *   • `domain.geometryKind === 'imported'` — direct snappy marker.
 *   • `domain.patches.length > 0` — even with `geometryKind ===
 *     'parametric'`, ANY non-empty patches array trips the snappy
 *     branch. This OR-semantics is the contract the renderer relies
 *     on when the user flips a single imported patch into the
 *     parametric-builder flow.
 *
 * The function is V1.35b-exported so vitest can drive it directly.
 * No renderCase round-trip is needed — the function returns pure
 * data (objects with two string fields).
 *
 * Test surface (11 assertions across 2 describe blocks):
 *   • `parametric branch` — base TEMPLATE_LAYOUT for cavity + the
 *     OR-of-4-kinds passthrough (channel/cylinder/airfoil currently
 *     share CAVITY_TEMPLATES; documenting that contract here so a
 *     future per-kind template population gets caught).
 *   • `imported branch` — emits 10 entries (base 8 minus 2 filtered
 *     plus 4 snappy variants), 0/U + 0/p are re-sourced from the
 *     snappy templates, snappyHexMeshDict + triSurfaceKeep are
 *     added, parametric 0/U.hbs + 0/p.hbs sources are filtered out,
 *     snappyHexMeshDict precedes triSurfaceKeep.
 *   • `entry shape invariant` — every emitted entry has non-empty
 *     `out` and `src` strings (defends against accidental null
 *     destructure regressions).
 */
import { describe, it, expect } from 'vitest';

import {
  CaseKindSchema,
  GeometryPatchSchema,
  type Domain,
  type GeometryPatchInput,
} from '@shared/types';
import { buildTemplateLayout } from '../case';

// V1.35b — `CaseKindSchema.options` (Zod v3 gives this as a
// readonly tuple) is the drift-safe source-of-truth for the
// case-kind roster. Pairing the import here with the schema's
// `z.enum([...literals])` literal means a future case kind (e.g.
// `cylinder-airfoil-combo`, `porous-medium`) lands in exactly one
// place and the test ripples through automatically. Same
// drift-safety pattern V1.33 closed for `LES_TURBULENCE_TYPES`.
const ALL_KINDS = CaseKindSchema.options;

/**
 * Build a structural-shape Domain that satisfies buildTemplateLayout's
 * two read-keys (`geometryKind` and `patches.length`) without dragging
 * in the full DomainSchema ceremony. The function under test does not
 * consult any other Domain field, so `as Domain` is sound here. The
 * cast tells TS the object is a Domain; it isn't fully populated, but
 * buildTemplateLayout's read surface is documented + tested, so any
 * future V.x that adds a new read-field will get a `tinyDomain` test
 * fixture gap flagged by the failing dependency. If the cast becomes a
 * maintenance liability, switch this helper to `Partial<Domain> &
 * Pick<Domain, 'geometryKind' | 'patches'>` for explicit type-allowance.
 */
function tinyDomain(
  geometryKind: 'parametric' | 'imported',
  patches: GeometryPatchInput[] = [],
): Domain {
  return { geometryKind, patches } as Domain;
}

function patch(name: string): GeometryPatchInput {
  // Round-trip via Zod so the literal is a valid GeometryPatch at the
  // type level. We don't care about validation here; we just want the
  // structural shape.
  return GeometryPatchSchema.parse({ name });
}

// ============================================================================

describe('V1.35b -- buildTemplateLayout: parametric branch', () => {
  it('cavity + parametric + no patches → 8-entry CAVITY_TEMPLATES base (verbatim)', () => {
    const result = buildTemplateLayout(tinyDomain('parametric', []), 'cavity');
    expect(result).toEqual([
      { out: 'system/blockMeshDict', src: 'blockMeshDict.hbs' },
      { out: 'system/controlDict', src: 'controlDict.hbs' },
      { out: 'system/fvSchemes', src: 'fvSchemes.hbs' },
      { out: 'system/fvSolution', src: 'fvSolution.hbs' },
      { out: 'constant/transportProperties', src: 'transportProperties.hbs' },
      { out: 'constant/momentumTransport', src: 'momentumTransport.hbs' },
      { out: '0/U', src: '0/U.hbs' },
      { out: '0/p', src: '0/p.hbs' },
    ]);
  });

  it('all 4 case kinds + parametric + no patches → identical 8-entry base (TEMPLATE_LAYOUT passthrough)', () => {
    // Channel/cylinder/airfoil currently share CAVITY_TEMPLATES via
    // TEMPLATE_LAYOUT. This pin catches the future V.x that builds
    // per-kind template layouts (e.g., snappyHexMesh cylinder patches
    // instead of cavity walls) without anyone noticing a regression
    // in one of the other 3 case kinds.
    const cavity = buildTemplateLayout(tinyDomain('parametric', []), 'cavity');
    for (const kind of ALL_KINDS) {
      expect(buildTemplateLayout(tinyDomain('parametric', []), kind)).toEqual(cavity);
    }
  });
});

// ============================================================================

describe('V1.35b -- buildTemplateLayout: imported branch', () => {
  it('cavity + imported + no patches → 10 entries (8 - 2 filtered + 4 snappy variants)', () => {
    const result = buildTemplateLayout(tinyDomain('imported', []), 'cavity');
    expect(result).toHaveLength(10);
  });

  it('cavity + imported + 1 patch → still 10 entries (geometryKind drives)', () => {
    const result = buildTemplateLayout(tinyDomain('imported', [patch('p0')]), 'cavity');
    expect(result).toHaveLength(10);
  });

  it('parametric + 1 patch → trips imported branch (OR semantics: any patches forces snappy)', () => {
    // The OR contract: even with geometryKind='parametric', a non-empty
    // patches array still uses the snappy branch. Users toggle snappy
    // mode by either flipping the radio OR by adding a single patch.
    // catches a regression where the OR becomes AND (and the parametric
    // + patch case silently ships parametric templates over imported
    // data).
    const result = buildTemplateLayout(tinyDomain('parametric', [patch('p0')]), 'cavity');
    expect(result).toHaveLength(10);
  });

  it('imported branch: 0/U and 0/p sources are snappy_U/0_p.hbs (not the parametric ones)', () => {
    const result = buildTemplateLayout(tinyDomain('imported', []), 'cavity');
    const uEntry = result.find((e) => e.out === '0/U');
    const pEntry = result.find((e) => e.out === '0/p');
    expect(uEntry?.src).toBe('snappy_U.hbs');
    expect(pEntry?.src).toBe('snappy_p.hbs');
  });

  it('imported branch: emits system/snappyHexMeshDict + constant/triSurface/.keep', () => {
    const result = buildTemplateLayout(tinyDomain('imported', []), 'cavity');
    expect(
      result.some((e) => e.out === 'system/snappyHexMeshDict' && e.src === 'snappyHexMeshDict.hbs'),
    ).toBe(true);
    expect(
      result.some((e) => e.out === 'constant/triSurface/.keep' && e.src === 'triSurfaceKeep.hbs'),
    ).toBe(true);
  });

  it('imported branch: filters out the parametric 0/U.hbs + 0/p.hbs sources', () => {
    // The filter step in buildTemplateLayout drops the parametric-
    // only `0/U.hbs` and `0/p.hbs` source paths. If the filter is
    // regressed (e.g., keying on `e.src` instead of `e.out`) we'd
    // see duplicate `0/U` entries (one from the parametric filter
    // pass-through + one from the appended snappy variant).
    const result = buildTemplateLayout(tinyDomain('imported', []), 'cavity');
    expect(result.some((e) => e.src === '0/U.hbs')).toBe(false);
    expect(result.some((e) => e.src === '0/p.hbs')).toBe(false);
  });

  it('imported branch: snappyHexMeshDict precedes triSurfaceKeep in the layout order', () => {
    // Documenting the deserialization order: the parametric system
    // files come first, then the snappy system file is inserted
    // AFTER system/fvSolution + constant/* but BEFORE constant/
    // triSurface/.keep (the post-snappy placeholder). renderCase
    // emits in this exact order; flipping it would change the
    // on-disk emission order (no behavior difference for OpenFOAM
    // but confusing for the git-history curation of an authored
    // case).
    const result = buildTemplateLayout(tinyDomain('imported', []), 'cavity');
    const sIdx = result.findIndex((e) => e.out === 'system/snappyHexMeshDict');
    const tIdx = result.findIndex((e) => e.out === 'constant/triSurface/.keep');
    expect(sIdx).toBeGreaterThanOrEqual(0);
    expect(tIdx).toBeGreaterThanOrEqual(0);
    expect(sIdx).toBeLessThan(tIdx);
  });

  it('imported branch: parametric system/* files (blockMeshDict, controlDict, fvSchemes, fvSolution) precede snappy entry', () => {
    // The parametric system/* files keep their original positions
    // through the filter; only 0/U and 0/p get dropped/replaced.
    const result = buildTemplateLayout(tinyDomain('imported', []), 'cavity');
    const sIdx = result.findIndex((e) => e.out === 'system/snappyHexMeshDict');
    for (const out of ['system/blockMeshDict', 'system/controlDict', 'system/fvSchemes', 'system/fvSolution']) {
      const idx = result.findIndex((e) => e.out === out);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(sIdx);
    }
  });
});

// ============================================================================

describe('V1.35b -- buildTemplateLayout: entry shape invariant', () => {
  it('every emitted entry has non-empty out + src string fields (across both branches)', () => {
    // Defends against accidental `undefined` destructure regressions
    // where a future V.x renames or types one of the fields. The
    // invariant is what renderCase relies on for its loop body
    // (`path.join(kindTplDir, tpl.src)` and `path.join(outDir, tpl.out)`).
    const parametric = buildTemplateLayout(tinyDomain('parametric', []), 'cavity');
    const imported = buildTemplateLayout(tinyDomain('imported', []), 'cavity');
    for (const entry of [...parametric, ...imported]) {
      expect(typeof entry.out).toBe('string');
      expect(typeof entry.src).toBe('string');
      expect(entry.out.length).toBeGreaterThan(0);
      expect(entry.src.length).toBeGreaterThan(0);
    }
  });
});
