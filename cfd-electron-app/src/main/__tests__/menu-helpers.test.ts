/**
 * V1.43 — vitest suite for buildApplicationMenuTemplate.
 *
 *  The pure platform-aware application-menu template builder
 *  lifted from src/main/index.ts's `setApplicationMenu` into
 *  @main/menu-helpers. The helper takes a `platform` argument
 *  (parameterized for testability) and an `appName` argument
 *  (for the macOS app-menu label) and returns a
 *  `MenuItemConstructorOptions[]` template. The impure
 *  `Menu.setApplicationMenu(Menu.buildFromTemplate(...))`
 *  call stays in main/index.ts.
 *
 *  Mirrors the V1.37* / V1.38* test-file structures: pure-fn
 *  tests, no electron, no fs. The 4 platform-dependent branches
 *  (appMenuSubmenu, editExtras, windowExtras, top-level
 *  template's leading slot) are exercised for both macOS and
 *  Linux/Windows.
 */
import { describe, it, expect } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildApplicationMenuTemplate } from '../menu-helpers';

const APP_NAME = 'Splash-OpenFOAM';

/** Type guard: check that a submenu entry is a `{label, submenu}` shape. */
function isLabeledSubmenu(
  entry: MenuItemConstructorOptions,
): entry is MenuItemConstructorOptions & { label: string; submenu: MenuItemConstructorOptions[] } {
  return typeof entry.label === 'string' && Array.isArray(entry.submenu);
}

/** Type guard: extract the File submenu's role entries (1-entry array). */
function fileSubmenuRoles(template: MenuItemConstructorOptions[]): string[] {
  const file = template.find(isLabeledSubmenu);
  // The first labeled submenu is either the macOS app-menu slot
  //  or the File submenu (depending on platform). For the File
  //  submenu we look for the one labeled 'File' specifically.
  const fileEntry = template.find((e) => isLabeledSubmenu(e) && e.label === 'File');
  if (!fileEntry || !isLabeledSubmenu(fileEntry)) return [];
  return fileEntry.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
}

describe('buildApplicationMenuTemplate — macOS (darwin)', () => {
  const template = buildApplicationMenuTemplate('darwin', APP_NAME);

  it("prepends the app-menu slot as the first labeled submenu (macOS convention)", () => {
    // The macOS branch prepends `{ label: appName, submenu: appMenuSubmenu }`
    //  as the first element. The label is the app name (e.g. 'Splash-OpenFOAM').
    const first = template[0];
    expect(isLabeledSubmenu(first)).toBe(true);
    if (isLabeledSubmenu(first)) {
      expect(first.label).toBe(APP_NAME);
    }
  });

  it("app-menu submenu contains the standard macOS About/Services/Hide/Quit roles", () => {
    // The macOS app menu has 9 entries: about, separator, services,
    //  separator, hide, hideOthers, unhide, separator, quit. Pin
    //  the role string sequence so a future "tighten the macOS
    //  app menu" pass gets caught.
    const first = template[0];
    if (!isLabeledSubmenu(first)) throw new Error('expected labeled submenu');
    const roles = first.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
    expect(roles).toEqual([
      'about', '', 'services', '', 'hide', 'hideOthers', 'unhide', '', 'quit',
    ]);
  });

  it("File submenu uses the 'close' role on macOS (not 'quit')", () => {
    // macOS convention: File menu has 'close' rather than 'quit'
    //  (Quit lives on the app-menu). The helper swaps the File
    //  submenu role based on platform.
    const roles = fileSubmenuRoles(template);
    expect(roles).toEqual(['close']);
  });

  it("Edit submenu includes 'pasteAndMatchStyle' as a macOS-specific extra", () => {
    // The macOS Edit submenu adds pasteAndMatchStyle (which is a
    //  macOS-specific role that doesn't exist on Linux/Windows).
    //  Pin the full Edit submenu role sequence: undo, redo, '',
    //  cut, copy, paste, pasteAndMatchStyle, delete, selectAll.
    const edit = template.find((e) => isLabeledSubmenu(e) && e.label === 'Edit');
    if (!edit || !isLabeledSubmenu(edit)) throw new Error('expected Edit submenu');
    const roles = edit.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
    expect(roles).toEqual([
      'undo', 'redo', '', 'cut', 'copy', 'paste',
      'pasteAndMatchStyle', 'delete', 'selectAll',
    ]);
  });

  it("Window submenu includes the macOS-specific 'front' and 'window' roles", () => {
    // The macOS Window submenu adds 'front' (bring all to front)
    //  and 'window' (window list) roles, both macOS-specific.
    //  Pin the full Window submenu role sequence: minimize, zoom,
    //  '', front, '', window.
    const window = template.find((e) => isLabeledSubmenu(e) && e.label === 'Window');
    if (!window || !isLabeledSubmenu(window)) throw new Error('expected Window submenu');
    const roles = window.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
    expect(roles).toEqual(['minimize', 'zoom', '', 'front', '', 'window']);
  });

  it("View submenu is platform-agnostic (identical on macOS and Linux/Windows)", () => {
    // The View submenu has no platform-dependent branches; pin
    //  the full role sequence as a regression-net for any
    //  future "add a view role" pass.
    const view = template.find((e) => isLabeledSubmenu(e) && e.label === 'View');
    if (!view || !isLabeledSubmenu(view)) throw new Error('expected View submenu');
    const roles = view.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
    expect(roles).toEqual([
      'reload', 'forceReload', 'toggleDevTools', '',
      'resetZoom', 'zoomIn', 'zoomOut', '',
      'togglefullscreen',
    ]);
  });
});

describe('buildApplicationMenuTemplate — Linux/Windows', () => {
  // V1.43 — exercise both linux and win32 (the only 2 non-darwin
  //  platforms the helper routes). Both should produce identical
  //  output (the helper has a binary isMac check, not a 3-way
  //  switch), but pinning both platforms guards against a future
  //  "add a per-platform branch" pass.
  it("linux: does NOT prepend the app-menu slot", () => {
    const template = buildApplicationMenuTemplate('linux', APP_NAME);
    const first = template[0];
    // On Linux, the first labeled submenu is File (not the app-menu).
    if (isLabeledSubmenu(first)) {
      expect(first.label).not.toBe(APP_NAME);
    }
  });

  it("win32: does NOT prepend the app-menu slot", () => {
    const template = buildApplicationMenuTemplate('win32', APP_NAME);
    const first = template[0];
    if (isLabeledSubmenu(first)) {
      expect(first.label).not.toBe(APP_NAME);
    }
  });

  it("linux: File submenu uses the 'quit' role (not 'close')", () => {
    // Linux/Windows convention: File menu has 'quit' (no separate
    //  app-menu Quit slot).
    const template = buildApplicationMenuTemplate('linux', APP_NAME);
    const roles = fileSubmenuRoles(template);
    expect(roles).toEqual(['quit']);
  });

  it("linux: Edit submenu uses 'delete' + separator + 'selectAll' (no 'pasteAndMatchStyle')", () => {
    // The Linux/Windows Edit submenu has 9 entries: undo, redo, '',
    //  cut, copy, paste, delete, '', selectAll. Note the separator
    //  before selectAll (macOS has no separator there because the
    //  pasteAndMatchStyle role already provides visual separation).
    const template = buildApplicationMenuTemplate('linux', APP_NAME);
    const edit = template.find((e) => isLabeledSubmenu(e) && e.label === 'Edit');
    if (!edit || !isLabeledSubmenu(edit)) throw new Error('expected Edit submenu');
    const roles = edit.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
    expect(roles).toEqual([
      'undo', 'redo', '', 'cut', 'copy', 'paste',
      'delete', '', 'selectAll',
    ]);
  });

  it("linux: Window submenu uses 'close' (not the macOS 'front'/'window' roles)", () => {
    const template = buildApplicationMenuTemplate('linux', APP_NAME);
    const window = template.find((e) => isLabeledSubmenu(e) && e.label === 'Window');
    if (!window || !isLabeledSubmenu(window)) throw new Error('expected Window submenu');
    const roles = window.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
    expect(roles).toEqual(['minimize', 'zoom', 'close']);
  });

  it("win32: produces identical output to linux (binary isMac branch)", () => {
    // The helper has a binary `isMac = platform === 'darwin'` check;
    //  linux and win32 both fall through to the same branch. Pin
    //  the structural equality as a regression-net for any future
    //  "add a per-platform branch" pass.
    const linuxTemplate = buildApplicationMenuTemplate('linux', APP_NAME);
    const win32Template = buildApplicationMenuTemplate('win32', APP_NAME);
    expect(win32Template).toEqual(linuxTemplate);
  });

  it("linux: View submenu is platform-agnostic (9-entry role sequence identical to macOS)", () => {
    // V1.43 SHIP-final: mirrors the macOS View test for direct diff.
    const template = buildApplicationMenuTemplate('linux', APP_NAME);
    const view = template.find((e) => isLabeledSubmenu(e) && e.label === 'View');
    if (!view || !isLabeledSubmenu(view)) throw new Error('expected View submenu');
    const roles = view.submenu.map((s) => ('role' in s && typeof s.role === 'string' ? s.role : ''));
    expect(roles).toEqual([
      'reload', 'forceReload', 'toggleDevTools', '',
      'resetZoom', 'zoomIn', 'zoomOut', '',
      'togglefullscreen',
    ]);
  });
});
