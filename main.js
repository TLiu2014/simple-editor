const { app, BrowserWindow, dialog, ipcMain, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Set app name
app.setName('Simple Editor');

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

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-new-tab');
            }
          }
        },
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-open-file');
            }
          }
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-save-file');
            }
          }
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-close-tab');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Outline',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-toggle-outline');
            }
          }
        },
        {
          label: 'Toggle Word Count',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-toggle-word-count');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Auto Save',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-toggle-auto-save');
            }
          }
        },
        {
          label: 'Toggle Status Bar',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-toggle-status-bar');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Editor Mode',
          submenu: [
            {
              label: 'Monaco Editor',
              type: 'radio',
              click: () => {
                if (mainWindow) {
                  mainWindow.webContents.send('menu-editor-mode', 'monaco');
                }
              }
            },
            {
              label: 'TipTap Editor',
              type: 'radio',
              click: () => {
                if (mainWindow) {
                  mainWindow.webContents.send('menu-editor-mode', 'tiptap');
                }
              }
            }
          ]
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-open-settings');
            }
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: 'About ' + app.getName() },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide ' + app.getName() },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit ' + app.getName() }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}


app.whenReady().then(() => {
  createMenu();
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
ipcMain.handle('save-file', async (event, data) => {
  try {
    let filePath;
    let content;
    
    // Support both old format (just content) and new format (object with filePath and content)
    if (typeof data === 'string') {
      content = data;
      if (!currentFilePath) {
        const userDataPath = app.getPath('userData');
        filePath = path.join(userDataPath, 'auto-save.txt');
      } else {
        filePath = currentFilePath;
      }
    } else {
      filePath = data.filePath;
      content = data.content;
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
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
      ],
      modal: true
    });

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
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
      properties: ['openFile'],
      modal: true
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

// Save open files list
ipcMain.handle('save-open-files', async (event, openFiles) => {
  try {
    const userDataPath = app.getPath('userData');
    const openFilesPath = path.join(userDataPath, 'open-files.json');
    fs.writeFileSync(openFilesPath, JSON.stringify(openFiles, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get open files list
ipcMain.handle('get-open-files', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const openFilesPath = path.join(userDataPath, 'open-files.json');
    if (fs.existsSync(openFilesPath)) {
      const data = fs.readFileSync(openFilesPath, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error reading open files:', error);
    return [];
  }
});

// Read file content
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, data: content };
    }
    return { success: false, error: 'File not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Settings handlers
ipcMain.handle('get-settings', () => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading settings:', error);
  }
  // Return default settings
  return {
    editorMode: 'monaco',
    fontSize: 14,
    theme: 'vs-dark',
    fontColor: '#cccccc',
    backgroundColor: '#1e1e1e',
    wordWrap: 'on',
    minimap: true,
    lineNumbers: true,
    autoSave: true,
    autoSaveInterval: 1000,
    wordCountOptions: {
      showChineseWordCount: true,
      showEnglishWordCount: true,
      showTotalWordCount: true,
      showCharacterCount: true,
      showWordCountBreakdown: true,
      showLineCount: false,
      showParagraphCount: false
    },
    viewOptions: {
      showOutline: false,
      showWordCount: true, // Word count in status bar is visible by default
      showStatusBar: true,
      showFormatBarBoldItalic: true,
      showFormatBarLists: true,
      showFormatBarColors: true
    }
  };
});

ipcMain.handle('save-settings', async (event, settings) => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    // Notify main window to update settings
    if (mainWindow) {
      mainWindow.webContents.send('settings-updated', settings);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
