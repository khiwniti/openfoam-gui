/**
 * V1.43 — pure platform-aware application-menu template builder
 *  lifted from src/main/index.ts.
 *
 * The Electron `setApplicationMenu(Menu.buildFromTemplate(...))`
 *  call is impure (writes to the OS application menu), but the
 *  template construction itself is a pure `(platform) =>
 *  MenuItemConstructorOptions[]` transformation. The template
 *  has 4 platform-dependent branches:
 *
 *    1. `appMenuSubmenu` (macOS only) — the leftmost app menu
 *       (About / Services / Hide / Quit) that macOS expects
 *       but Linux/Windows don't render.
 *    2. `editExtras` — the trailing items in the Edit submenu
 *       (pasteAndMatchStyle is macOS-only).
 *    3. `windowExtras` — the trailing items in the Window
 *       submenu (front / window roles are macOS-only; close
 *       is the Linux/Windows equivalent).
 *    4. The top-level template's leading `{ label: app.name,
 *       submenu: appMenuSubmenu }` slot — only present on macOS.
 *
 * V1.43 lifts the pure template construction here so vitest can
 *  exercise both branches (`platform === 'darwin'` vs the
 *  Linux/Windows fallthrough) without spinning up Electron.
 *  src/main/index.ts keeps the impure `Menu.setApplicationMenu(
 *  Menu.buildFromTemplate(buildApplicationMenuTemplate(
 *  process.platform)))` call.
 *
 * The template is byte-for-byte equivalent to the inline
 *  construction it replaced — the 4 named typed arrays
 *  (`appMenuSubmenu`, `editExtras`, `windowExtras`, `template`)
 *  are constructed in the same order with the same content.
 *  The only difference is the `isMac` check now reads from the
 *  parameterized `platform` argument rather than
 *  `process.platform`, so tests can pin both branches.
 */
import { type MenuItemConstructorOptions } from 'electron';

export function buildApplicationMenuTemplate(
  platform: NodeJS.Platform,
  appName: string,
): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin';

  const editExtras: MenuItemConstructorOptions[] = isMac
    ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }]
    : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }];

  const windowExtras: MenuItemConstructorOptions[] = isMac
    ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
    : [{ role: 'close' }];

  // Mac-only app-menu submenu (About / Services / Hide / Quit).
  //  Hoisted into a named typed array for symmetry with
  //  editExtras/windowExtras.
  const appMenuSubmenu: MenuItemConstructorOptions[] = [
    { role: 'about' },
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: appName, submenu: appMenuSubmenu }]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...editExtras,
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...windowExtras],
    },
  ];

  return template;
}
