/**
 * Electron main process entry — bootstraps the window and registers IPC.
 */
import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc/index.js';
// V1.43 — pure platform-aware application-menu template builder
//  lifted from this file's `setApplicationMenu` into
//  @main/menu-helpers. The template construction is now
//  vitest-exercisable for both macOS and Linux/Windows
//  branches; the impure `Menu.setApplicationMenu(
//  Menu.buildFromTemplate(...))` call stays in this file.
import { buildApplicationMenuTemplate } from './menu-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
// __dirname is used as anchor below if needed

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block navigation to other origins
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
    if (!allowed) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow);
  createWindow();
  setApplicationMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Hardening: disable webContents from opening new windows we didn't authorize
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

/**
 * V1.43 — install the standard platform-aware application menu.
 *
 * The pure template construction is lifted to
 *  @main/menu-helpers.buildApplicationMenuTemplate (vitest-
 *  exercised for both macOS and Linux/Windows branches). This
 *  function keeps only the impure `Menu.setApplicationMenu(
 *  Menu.buildFromTemplate(...))` call.
 *
 * V1.32 — original V1.32 docblock (preserved): macOS expects
 *  an app-menu (About / Services / Hide / Quit) as the leftmost
 *  submenu; Linux / Windows don't render the slot. The Edit /
 *  View / Window submenus use the cross-platform Electron
 *  default roles so the same template ships on every OS
 *  without per-platform re-arrangement beyond the standard
 *  pasteAndMatchStyle / `Window > front` extras that macOS
 *  conventions add.
 *
 * Called inside `app.whenReady()` so the Menu API is fully
 *  wired up.
 */
function setApplicationMenu() {
  const template = buildApplicationMenuTemplate(process.platform, app.name);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
