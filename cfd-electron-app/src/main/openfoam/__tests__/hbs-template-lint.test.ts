/**
 * V1.48 — `.hbs` template hygiene lint test.
 *
 * Two pattern checks against every `.hbs` file under
 * `resources/templates/`:
 *
 *   A) PARSE-ERROR GUARD — no C++ comment (line OR block) may contain a
 *      raw `{{` character. Handlebars strips `{{!-- ... --}}` block
 *      comments from rendered output, but it does NOT understand either
 *      C++ style `//` line comments OR C++ block-comments (Handlebars
 *      treats their delimiters as raw text in this codebase). A
 *      literal `{{#if}}` inside any C++ comment opens a Handlebars block
 *      expression that never closes until EOF, triggering
 *      "Expecting 'OPEN_INVERSE_CHAIN'… 'EOF'" parse errors at render
 *      time. V1.47 SHIP-final-2 / SHIP-final-3 hit this exact pattern
 *      with a stray `{{#if}}` inside an explanatory C++ comment; this
 *      test catches that class at unit-test time.
 *
 *   B) ASSERTION-SUBSTRING GUARD — no C++ comment (line OR block) may
 *      contain a substring asserted verbatim by any e2e/vitest
 *      `.not.toContain(N)` or `.toMatch(/.../)` regression-lock. The
 *      runtime: rendered `.hbs` output INCLUDES C++ comments verbatim,
 *      so a substring collision (e.g., a `//  ... (\`not.toContain('div
 *      (phi,k)')\`) ...` comment in the explanatory prose) makes
 *      `.not.toContain('div(phi,k)')` match the COMMENT TEXT — not any
 *      active divergence line — producing a false-positive failure. The
 *      V1.47 SHIP-final convergence round surfaced this exact pattern;
 *      the 4-substring list below is mirrored 1-to-1 with the 4 inverse-
 *      assertions in `e2e-render.test.ts`'s buoyantSimpleFoam it-case.
 *
 * EXTENSION POLICY: as new inverse-regression assertion substrings land
 * (V.x ≥ 49), append them to ASSERTION_SUBSTRINGS_EXCLUDED_FROM_COMMENTS
 * below. Fully-dynamic extraction (parse every `*.test.ts` for
 * `.not.toContain('XXX')` literals + `.toMatch(/YYY/)` regex bodies) is
 * deferred — brittle to regex-syntax noise. Hardcoded 4-entry list is
 * exact-fit for the known failing pattern.
 */
import { describe, it } from 'vitest';
import { promises as fs, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Inverse-regression assertion substrings asserted by e2e tests via
 * `.not.toContain(N)`. These MUST NOT appear verbatim inside any active
 * C++ `//` line of any `.hbs` template, else the test would match the
 * comment text rather than any active directive.
 */
const ASSERTION_SUBSTRINGS_EXCLUDED_FROM_COMMENTS: readonly string[] = [
  'div(phi,k)',
  'div(phi,epsilon)',
  'div(phi,omega)',
  'div(phi,nuTilda)',
];

/** Recursively enumerate every `.hbs` file under `root`. Tests a narrow
 *  surface (cfd-electron-app/resources/templates/), so a hand-rolled
 *  walk avoids the `tinyglobby` dep. */
function listHbsFiles(root: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.name.endsWith('.hbs')) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out.sort();
}

/** Strip Handlebars block-comment regions `{{!-- ... --}}`. Those are
 *  Handlebars-stripped from rendered output so any `{{` inside them is
 *  invisible to the rendered file — exempt from check A. */
function stripHandlebarsBlockComments(src: string): string {
  return src.replace(/{{!--[\s\S]*?--}}/g, '');
}

/** Find the first C++ `//` line-comment in `line`, returning the slice
 *  starting at `//` (inclusive). Returns `null` if the line has no
 *  `//`, or if the first `//` is inside a Handlebars expression (block
 *  opener `{{…}}`). Nested `{{!--…--}}` calls are not encountered here
 *  because stripHandlebarsBlockComments has already removed them. */
function findCppComment(line: string): string | null {
  let i = 0;
  let inHbs = false;
  while (i < line.length) {
    if (i + 1 < line.length && line[i] === '{' && line[i + 1] === '{') {
      inHbs = true;
      i += 2;
      continue;
    }
    if (inHbs && i + 1 < line.length && line[i] === '}' && line[i + 1] === '}') {
      inHbs = false;
      i += 2;
      continue;
    }
    if (!inHbs && i + 1 < line.length && line[i] === '/' && line[i + 1] === '/') {
      return line.slice(i);
    }
    i++;
  }
  return null;
}

/** Find every C++ `/* … * /` block-comment substring in `src` (Handlebars-
 *  block-comment regions `{{!-- … --}}` already stripped by caller).
 *  Returns each matched substring for caller inspection. */
function findCppBlockComments(src: string): Array<{ start: number; content: string }> {
  const out: Array<{ start: number; content: string }> = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({ start: m.index, content: m[0] });
  }
  return out;
}

/** Convert a string index in the ACTIVE (post-stripHandlebarsBlockComments)
 *  content of a file into a 1-based line number. Used to localise a
 *  C++ block-comment violation in the original file. */
function indexToLine(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

describe('V1.48 — .hbs template hygiene lint', () => {
  const files = listHbsFiles('resources/templates');

  it('A) no C++ comment (line OR block) contains raw `{{` characters (parse-error class)', async () => {
    const violations: { file: string; line: number; text: string; kind: 'line' | 'block' }[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const active = stripHandlebarsBlockComments(raw);
      const lines = active.split('\n');
      // C++ `//` line-comments (per-line scan; `//` is line-scoped).
      for (const [i, line] of lines.entries()) {
        const commentText = findCppComment(line);
        if (commentText === null) continue;
        // Only flag BLOCK-level Handlebars — `{{#…}}`, `{{^…}}`, `{{/…}}` —
        // which must be balanced by a matching close. A simple
        // `{{variable}}` interpolation is safe inside a C++ comment
        // (Handlebars evaluates it inline at render time and emits
        // the interpolated value into the rendered file's comment
        // text). The check matches the failing pattern from V1.47:
        // an unclosed `{{#if}}` literally present in a comment.
        if (/\{\{[#^/]/.test(commentText)) {
          violations.push({ file, line: i + 1, text: line.trim(), kind: 'line' });
        }
      }
      // C++ `/* ... */` block-comments (multi-line; scanned in the full
      // active content). Same bug class — Handlebars doesn't understand
      // C++ block-comments either. The FoamFile ASCII-art header at the
      // top of every .hbs file is one such block; it may legitimately
      // contain `{{variable}}` interpolations (e.g. partials.hbs's
      // `Version: {{openfoamVersion}}` line, which is the entire
      // point of Make-COMMON-conventional). Only flag BLOCK-level
      // Handlebars — never single-value interpolations.
      for (const block of findCppBlockComments(active)) {
        if (/\{\{[#^/]/.test(block.content)) {
          violations.push({
            file,
            line: indexToLine(active, block.start),
            text: block.content.replace(/\s+/g, ' ').trim().slice(0, 120),
            kind: 'block',
          });
        }
      }
    }
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  [${v.kind}] ${v.file}:${v.line}: ${v.text}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} C++ comment(s) (line or block) containing literal '{{'.\n` +
          `Handlebars does NOT understand C++ comments — a \`{{#if...}}\` literal inside either \`//\` or \`/* */\` raises "Expecting 'OPEN_INVERSE_CHAIN'… 'EOF'" at render time.\n` +
          `Either (a) rephrase the comment to drop the literal \`{{\`, or (b) replace with a Handlebars \`{{!-- ... --}}\` block comment (which IS stripped from rendered output).\n\n` +
          `Violations:\n${detail}`,
      );
    }
  });

  it('B) no C++ comment (line OR block) contains a substring asserted verbatim by an e2e regression lock (test-collision class)', async () => {
    const violations: { file: string; line: number; text: string; needle: string; kind: 'line' | 'block' }[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const active = stripHandlebarsBlockComments(raw);
      const lines = active.split('\n');
      // C++ `//` line-comments
      for (const [i, line] of lines.entries()) {
        const commentText = findCppComment(line);
        if (commentText === null) continue;
        for (const needle of ASSERTION_SUBSTRINGS_EXCLUDED_FROM_COMMENTS) {
          if (commentText.includes(needle)) {
            violations.push({
              file,
              line: i + 1,
              text: line.trim(),
              needle,
              kind: 'line',
            });
          }
        }
      }
      // C++ `/* ... */` block-comments (multi-line; scanned in the full
      // active content). Same substring-collision class as line-comments.
      for (const block of findCppBlockComments(active)) {
        for (const needle of ASSERTION_SUBSTRINGS_EXCLUDED_FROM_COMMENTS) {
          if (block.content.includes(needle)) {
            violations.push({
              file,
              line: indexToLine(active, block.start),
              text: block.content.replace(/\s+/g, ' ').trim().slice(0, 120),
              needle,
              kind: 'block',
            });
          }
        }
      }
    }
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  [${v.kind}] ${v.file}:${v.line}: needle="${v.needle}": ${v.text}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} C++ comment(s) (line or block) containing substrings asserted verbatim by e2e tests.\n` +
          `Rendered \`.hbs\` output INCLUDES C++ comments verbatim — both \`//\` line-comments and \`/* *\/\` block-comments survive, so a substring collision in either makes a regression-lock's \`.not.toContain(N)\` match COMMENT TEXT rather than any active directive.\n` +
          `Rephrase the comment to drop the literal ${ASSERTION_SUBSTRINGS_EXCLUDED_FROM_COMMENTS.map((s) => `"${s}"`).join(', ')} substrings.\n\n` +
          `Violations:\n${detail}`,
      );
    }
  });
});
