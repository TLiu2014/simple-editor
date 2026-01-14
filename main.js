const { app, BrowserWindow, dialog, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// Enable hot reload in development (optional)
try {
  const electronReload = require('electron-reload');
  electronReload(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
} catch (err) {
  // electron-reload is optional, only needed in development
  // If not installed, the app will work without hot reload
}

let mainWindow;
let currentFilePath = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false // Allow loading local files
    }
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development (temporarily enabled for debugging)
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle auto save
ipcMain.handle('save-file', async (event, content) => {
  try {
    if (!currentFilePath) {
      // If no file path, save to a default location
      const userDataPath = app.getPath('userData');
      currentFilePath = path.join(userDataPath, 'auto-save.txt');
    }
    
    fs.writeFileSync(currentFilePath, content, 'utf-8');
    return { success: true, path: currentFilePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file save as
ipcMain.handle('save-file-as', async (event, content) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save File',
      defaultPath: 'untitled.txt',
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      currentFilePath = result.filePath;
      fs.writeFileSync(currentFilePath, content, 'utf-8');
      return { success: true, path: currentFilePath };
    }
    
    return { success: false, canceled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle setting current file path
ipcMain.handle('set-current-file-path', async (event, filePath) => {
  currentFilePath = filePath;
  return { success: true };
});

// Handle file open
ipcMain.handle('open-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open File',
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      currentFilePath = result.filePaths[0];
      const content = fs.readFileSync(currentFilePath, 'utf-8');
      return { success: true, content, path: currentFilePath };
    }
    
    return { success: false, canceled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get current file path
ipcMain.handle('get-current-file-path', () => {
  return currentFilePath;
});
