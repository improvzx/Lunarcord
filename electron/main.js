const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
let selectedCaptureSourceId = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111318',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'client', 'index.html'));
}

app.whenReady().then(() => {
  process.env.LUNARCORD_DATA_DIR = path.join(app.getPath('userData'), 'server-data');
  require('../server/index.js');
  ipcMain.handle('capture-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    return sources.map(source => ({ id: source.id, name: source.name }));
  });
  ipcMain.on('select-capture-source', (_event, id) => { selectedCaptureSourceId = id; });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => ['media', 'display-capture'].includes(permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 }
      });
      const screen = sources.find(source => source.id === selectedCaptureSourceId) || sources.find(source => source.id.startsWith('screen:')) || sources[0];
      callback({ video: screen, audio: 'loopback' });
    } catch (_error) {
      callback({});
    }
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
