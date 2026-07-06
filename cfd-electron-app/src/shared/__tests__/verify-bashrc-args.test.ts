/**
 * V1.36c — drift-safety pin for `VerifyBashrcArgsSchema`, the IPC
 * envelope schema lifted out of the previously-inline
 * `z.object({ path: z.string() })` parse in the `openfoamVerifyBashrc`
 * handler in `src/main/ipc/index.ts`.
 *
 * The lift follows the V1.31a / V1.35c precedent already established
 * by `RunStartEnvelopeSchema` /
 * `run-payload-schemas.test.ts` and `GeometryFilePickArgsSchema` /
 * `geometry-ipc-schemas.test.ts` — pin the wire-format shape so
 * renderer/main drift (a renderer-side `bashrcPath` rename, a
 * `mustBeAbsolute` added by a future V.x) fails at parse time before
 * reaching the IPC handler.
 *
 * Coverage scope (3 it-blocks):
 *   - happy path: `{ path: '/some/bashrc' }` parses, .path round-trips.
 *   - missing key: `{}` throws ZodError with the expected issue path.
 *   - wrong type: `{ path: 123 }` throws (path must be string, no
 *     coercion per Zod's default).
 *
 * Why no "extra unknown keys silently strip" test: that contract is
 * enforced by Zod's default `.object({...})` (no `.strict()`) and
 * is shared across all envelope schemas; testing it once in the
 * geometry-ipc-schemas pair is sufficient.
 */
import { describe, it, expect } from 'vitest';
import { VerifyBashrcArgsSchema } from '@shared/types';

describe('VerifyBashrcArgsSchema', () => {
  it('parses a canonical { path: string } envelope and round-trips the value', () => {
    const parsed = VerifyBashrcArgsSchema.parse({ path: '/opt/openfoam/etc/bashrc' });
    expect(parsed.path).toBe('/opt/openfoam/etc/bashrc');
  });

  it('rejects an envelope with the path key missing', () => {
    // Renderer-side bug proxy: forgetting to pass `path` would
    //  silently coerce to `undefined` and reach verifyBashrc as a
    //  bad path. Catch at parse time.
    expect(() => VerifyBashrcArgsSchema.parse({})).toThrow();
    try {
      VerifyBashrcArgsSchema.parse({});
    } catch (err) {
      // ZodError exposes `.issues[].path` for downstream debugging;
      //  pin the missing key is reported at `path` (not `bashrc`).
      const issues = (err as { issues?: { path: (string | number)[] }[] }).issues ?? [];
      const paths = issues.flatMap((i) => i.path);
      expect(paths).toContain('path');
    }
  });

  it('rejects an envelope where path is not a string', () => {
    // Renderer-side bug proxy: a render bug caused a `Number(bashrcPath)`
    //  compute to land in the wire. Zod's default `.string()` does
    //  NOT coerce 123 → '123'; it throws. Pinning this catches the
    //  off-by-one typing class of bugs early.
    expect(() => VerifyBashrcArgsSchema.parse({ path: 123 })).toThrow();
  });
});
