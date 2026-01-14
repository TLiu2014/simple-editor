// Use Node's require (saved before Monaco loader)
const { ipcRenderer } = (window.nodeRequire || require)('electron');
const process = (window.nodeRequire || require)('process');

let editor;
let autoSaveInterval;
let autoSaveEnabled = true; // Auto-save is enabled by default
let wordCountVisible = false;
let outlineVisible = false;
let statusBarVisible = true; // Status bar visible by default
let outlineItems = [];
let saveIndicatorTimeout = null;
let lastSavedContent = {}; // Track last saved content per tab

// Tab management
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let settingsTabId = null; // Special tab ID for settings

// Settings management
let originalSettings = null; // Store original settings for cancel
let currentSettings = null; // Current settings being previewed

// Initialize when Monaco is ready
function initializeEditor() {
  const container = document.getElementById('editor-container');
  if (!container) {
    setTimeout(initializeEditor, 100);
    return;
  }

  // Check if Monaco loader is available (Monaco's require, not Node's)
  // Monaco's require has a config method
  if (typeof require === 'undefined' || typeof require.config !== 'function') {
    setTimeout(initializeEditor, 100);
    return;
  }

  // Configure Monaco to use HTTP instead of Node's fs
  // This prevents the loader from trying to use Node's file system
  if (typeof self !== 'undefined' && !self.require) {
    self.require = require;
  }

  // Initialize Monaco Editor using Monaco's require
  require(['vs/editor/editor.main'], function () {
    try {
      if (!container) {
        console.error('Editor container not found');
        return;
      }

      editor = monaco.editor.create(container, {
        value: '',
        language: 'plaintext',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: true },
        wordWrap: 'on',
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        tabSize: 2,
        insertSpaces: true
      });

      // Explicitly update options to ensure editor is editable
      editor.updateOptions({
        readOnly: false,
        domReadOnly: false
      });

      // Focus the editor and test typing
      setTimeout(() => {
        editor.focus();
        console.log('Editor focused and ready for input');
        console.log('ReadOnly:', editor.getRawOptions().readOnly);
      }, 100);

      // Setup auto save (every 2 seconds) - only if enabled
      startAutoSave();

      // Update word count and outline on content change
      editor.onDidChangeModelContent(() => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
          activeTab.content = editor.getValue();
          activeTab.modified = true;
          updateTabTitle(activeTabId);
        }
        updateWordCount();
        updateOutline();
      });

      console.log('Monaco Editor initialized successfully');
      
      // Load settings and apply them
      loadSettings();
      
      // Setup event listeners after editor is ready
      setupEventListeners();
      
      // Initialize status bar
      updateAutoSaveStatus();
      
      // Restore previously open files
      restoreOpenFiles();
      
      // If no tabs, show default view
      if (tabs.length === 0) {
        showDefaultView();
      }
    } catch (error) {
      console.error('Error initializing Monaco Editor:', error);
      console.error('Error stack:', error.stack);
    }
  });
}

// Wait for DOM and Monaco to be ready
function startInitialization() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEditor);
  } else {
    // DOM is already ready, wait a bit for Monaco loader
    setTimeout(initializeEditor, 200);
  }
}

startInitialization();

// Auto-save functions
async function startAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
  }
  
  if (autoSaveEnabled) {
    // Get current auto-save interval from settings
    const settings = await ipcRenderer.invoke('get-settings');
    const interval = settings.autoSaveInterval || 1000; // Default to 1 second
    
    autoSaveInterval = setInterval(() => {
      if (!editor || !activeTabId) return;
      
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (!activeTab || !activeTab.filePath) return;
      
      const content = editor.getValue();
      const lastSaved = lastSavedContent[activeTabId] || '';
      
      // Only save if content has actually changed from last saved version
      if (content !== lastSaved) {
        // Show saving indicator
        showSaveIndicator('saving');
        
        ipcRenderer.invoke('save-file', {
          filePath: activeTab.filePath,
          content: content
        }).then(result => {
          if (result.success) {
            // Update last saved content for this tab
            lastSavedContent[activeTabId] = content;
            activeTab.content = content;
            activeTab.modified = false;
            updateTabTitle(activeTabId);
            console.log('Auto-saved:', activeTab.filePath);
            // Show saved indicator
            showSaveIndicator('saved');
          } else {
            showSaveIndicator('');
          }
        }).catch(error => {
          console.error('Auto-save error:', error);
          showSaveIndicator('');
        });
      }
    }, interval);
  }
}

function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

function toggleAutoSave() {
  autoSaveEnabled = !autoSaveEnabled;
  
  if (autoSaveEnabled) {
    startAutoSave();
    console.log('Auto Save: ON');
  } else {
    stopAutoSave();
    console.log('Auto Save: OFF');
  }
  
  // Update status bar
  updateAutoSaveStatus();
  
  // Save the setting
  ipcRenderer.invoke('get-settings').then(settings => {
    settings.autoSave = autoSaveEnabled;
    ipcRenderer.invoke('save-settings', settings);
  });
}

function updateAutoSaveStatus() {
  const statusAutoSave = document.getElementById('status-auto-save');
  if (statusAutoSave) {
    statusAutoSave.textContent = `Auto Save: ${autoSaveEnabled ? 'ON' : 'OFF'}`;
  }
}

function toggleStatusBar() {
  statusBarVisible = !statusBarVisible;
  const statusBar = document.getElementById('status-bar');
  const mainContent = document.querySelector('.main-content');
  
  if (statusBar) {
    if (statusBarVisible) {
      statusBar.classList.remove('hidden');
      if (mainContent) {
        mainContent.classList.remove('no-status-bar');
      }
    } else {
      statusBar.classList.add('hidden');
      if (mainContent) {
        mainContent.classList.add('no-status-bar');
      }
    }
  }
}

function showSaveIndicator(status) {
  const indicator = document.getElementById('status-save-indicator');
  if (!indicator) return;
  
  // Clear any existing timeout
  if (saveIndicatorTimeout) {
    clearTimeout(saveIndicatorTimeout);
  }
  
  // Remove all status classes
  indicator.classList.remove('saving', 'saved', 'hidden');
  
  if (status === 'saving') {
    indicator.textContent = 'Saving...';
    indicator.classList.add('saving');
  } else if (status === 'saved') {
    indicator.textContent = 'Saved';
    indicator.classList.add('saved');
    // Hide after 2 seconds
    saveIndicatorTimeout = setTimeout(() => {
      indicator.classList.add('hidden');
    }, 2000);
  } else {
    indicator.classList.add('hidden');
  }
}

// Word count function (supports English and Chinese)
function countWords(text) {
  if (!text || text.trim().length === 0) {
    return { 
      words: 0, 
      characters: 0, 
      chineseChars: 0, 
      englishWords: 0,
      lines: 1,
      paragraphs: 0
    };
  }

  // Count Chinese characters (CJK unified ideographs)
  const chineseRegex = /[\u4e00-\u9fff]/g;
  const chineseMatches = text.match(chineseRegex);
  const chineseChars = chineseMatches ? chineseMatches.length : 0;

  // For English words, split by whitespace and filter empty strings
  // For Chinese, each character is typically considered a word
  const englishWords = text
    .replace(/[\u4e00-\u9fff]/g, ' ') // Replace Chinese with space
    .split(/\s+/)
    .filter(word => word.length > 0);

  const totalWords = chineseChars + englishWords.length;
  const totalCharacters = text.length;
  
  // Count lines (split by newline)
  const lines = text.split(/\r?\n/).length;
  
  // Count paragraphs (split by double newline or empty lines)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length || 1;

  return {
    words: totalWords,
    characters: totalCharacters,
    chineseChars: chineseChars,
    englishWords: englishWords.length,
    lines: lines,
    paragraphs: paragraphs
  };
}

function formatWordCount(counts, options = {}) {
  const parts = [];
  
  // Default options if not provided
  const opts = {
    showChineseWordCount: options.showChineseWordCount !== false,
    showEnglishWordCount: options.showEnglishWordCount !== false,
    showTotalWordCount: options.showTotalWordCount !== false,
    showCharacterCount: options.showCharacterCount !== false,
    showWordCountBreakdown: options.showWordCountBreakdown !== false,
    showLineCount: options.showLineCount || false,
    showParagraphCount: options.showParagraphCount || false
  };
  
  // Total word count
  if (opts.showTotalWordCount) {
    if (opts.showWordCountBreakdown) {
      // Show breakdown, but respect individual flags
      const breakdownParts = [];
      if (opts.showChineseWordCount) {
        breakdownParts.push(`Chinese: ${counts.chineseChars}`);
      }
      if (opts.showEnglishWordCount) {
        breakdownParts.push(`English: ${counts.englishWords}`);
      }
      
      if (breakdownParts.length > 0) {
        parts.push(`Words: ${counts.words} (${breakdownParts.join(', ')})`);
      } else {
        // If both are hidden, just show total
        parts.push(`Words: ${counts.words}`);
      }
    } else {
      parts.push(`Words: ${counts.words}`);
    }
  } else {
    // If total is hidden, show individual counts
    if (opts.showWordCountBreakdown) {
      // With breakdown format
      if (opts.showChineseWordCount) {
        parts.push(`Chinese: ${counts.chineseChars}`);
      }
      if (opts.showEnglishWordCount) {
        parts.push(`English: ${counts.englishWords}`);
      }
    } else {
      // Without breakdown format
      if (opts.showChineseWordCount) {
        parts.push(`Chinese Words: ${counts.chineseChars}`);
      }
      if (opts.showEnglishWordCount) {
        parts.push(`English Words: ${counts.englishWords}`);
      }
    }
  }
  
  // Character count
  if (opts.showCharacterCount) {
    parts.push(`Characters: ${counts.characters}`);
  }
  
  // Line count
  if (opts.showLineCount) {
    parts.push(`Lines: ${counts.lines}`);
  }
  
  // Paragraph count
  if (opts.showParagraphCount) {
    parts.push(`Paragraphs: ${counts.paragraphs}`);
  }
  
  return parts.length > 0 ? parts.join(' | ') : 'No statistics';
}

function updateWordCount() {
  if (!editor) return;

  const content = editor.getValue();
  const counts = countWords(content);
  
  // Use current preview settings if available (when settings tab is open), otherwise get from disk
  if (currentSettings && currentSettings.wordCountOptions) {
    // Use preview settings (immediate preview when settings tab is open)
    const wordCountOptions = currentSettings.wordCountOptions;
    const wordCountText = formatWordCount(counts, wordCountOptions);
    updateWordCountDisplay(wordCountText);
  } else {
    // Get from disk (normal operation when settings tab is not open)
    ipcRenderer.invoke('get-settings').then(settings => {
      const wordCountOptions = settings.wordCountOptions || {};
      const wordCountText = formatWordCount(counts, wordCountOptions);
      updateWordCountDisplay(wordCountText);
    });
  }
}

function updateWordCountDisplay(wordCountText) {
  // Update floating word count (if visible)
  const wordCountElement = document.getElementById('wordCountText');
  if (wordCountElement) {
    wordCountElement.textContent = wordCountText;
  }

  // Update status bar word count
  const statusWordCount = document.getElementById('status-word-count');
  if (statusWordCount) {
    statusWordCount.textContent = wordCountText;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Listen to menu events from main process
  ipcRenderer.on('menu-open-file', async () => {
    const result = await ipcRenderer.invoke('open-file');
    if (result.success && result.content !== undefined) {
      // Check if file is already open
      const existingTab = tabs.find(t => t.filePath === result.path);
      if (existingTab) {
        // Switch to existing tab instead of creating a new one
        switchTab(existingTab.id);
      } else {
        // File not open, create new tab
        createNewTab(result.path, result.content);
      }
    }
  });
  
  ipcRenderer.on('menu-new-tab', () => {
    createNewTab();
  });
  
  ipcRenderer.on('menu-close-tab', () => {
    if (activeTabId) {
      closeTab(activeTabId);
    }
  });

  ipcRenderer.on('menu-save-file', async () => {
    if (!activeTabId || !editor) return;
    
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return;
    
    const content = editor.getValue();
    
    // Show saving indicator
    showSaveIndicator('saving');
    
    if (activeTab.filePath) {
      // Save to existing file
      const result = await ipcRenderer.invoke('save-file', {
        filePath: activeTab.filePath,
        content: content
      });
      if (result.success) {
        // Update last saved content
        lastSavedContent[activeTabId] = content;
        activeTab.content = content;
        activeTab.modified = false;
        updateTabTitle(activeTabId);
        showSaveIndicator('saved');
      } else {
        showSaveIndicator('');
      }
    } else {
      // Save as new file
      const result = await ipcRenderer.invoke('save-file-as', content);
      if (result.success) {
        activeTab.filePath = result.path;
        // Update last saved content
        lastSavedContent[activeTabId] = content;
        activeTab.content = content;
        activeTab.modified = false;
        updateTabTitle(activeTabId);
        console.log('File saved to:', result.path);
        showSaveIndicator('saved');
      } else {
        showSaveIndicator('');
      }
    }
  });
  
  // New tab button
  const newTabBtn = document.getElementById('new-tab-btn');
  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => {
      createNewTab();
    });
  }
  
  // Default view buttons
  const defaultNewFileBtn = document.getElementById('default-new-file');
  const defaultOpenFileBtn = document.getElementById('default-open-file');
  
  if (defaultNewFileBtn) {
    defaultNewFileBtn.addEventListener('click', () => {
      createNewTab();
    });
  }
  
  if (defaultOpenFileBtn) {
    defaultOpenFileBtn.addEventListener('click', async () => {
      const result = await ipcRenderer.invoke('open-file');
      if (result.success && result.content !== undefined) {
        // Check if file is already open
        const existingTab = tabs.find(t => t.filePath === result.path);
        if (existingTab) {
          switchTab(existingTab.id);
        } else {
          createNewTab(result.path, result.content);
        }
      }
    });
  }

  ipcRenderer.on('menu-toggle-outline', () => {
    outlineVisible = !outlineVisible;
    const outlinePanel = document.getElementById('outline-panel');
    if (outlineVisible) {
      outlinePanel.classList.remove('hidden');
      updateOutline();
    } else {
      outlinePanel.classList.add('hidden');
    }
  });

  ipcRenderer.on('menu-toggle-word-count', () => {
    wordCountVisible = !wordCountVisible;
    // Control word count in status bar, not floating element
    const statusWordCount = document.getElementById('status-word-count');
    if (statusWordCount) {
      if (wordCountVisible) {
        statusWordCount.style.display = '';
        updateWordCount();
      } else {
        statusWordCount.style.display = 'none';
      }
    }
    
    // Also update settings if settings tab is open
    if (settingsTabId && currentSettings) {
      currentSettings.viewOptions = currentSettings.viewOptions || {};
      currentSettings.viewOptions.showWordCount = wordCountVisible;
      const showWordCountEl = document.getElementById('settings-showWordCount');
      if (showWordCountEl) {
        showWordCountEl.checked = wordCountVisible;
      }
    }
  });

  ipcRenderer.on('menu-toggle-auto-save', () => {
    toggleAutoSave();
  });

  ipcRenderer.on('menu-toggle-status-bar', () => {
    toggleStatusBar();
  });

  ipcRenderer.on('menu-open-settings', () => {
    openSettingsTab();
  });

  // Listen for settings updates
  ipcRenderer.on('settings-updated', async (event, settings) => {
    await applySettings(settings);
    // Update word count display when settings change
    updateWordCount();
  });
}

// Update shortcut display based on platform
function updateShortcutDisplay() {
  const isMac = process.platform === 'darwin';
  const shortcuts = {
    outline: isMac ? '⌘⇧O' : 'Ctrl+Shift+O',
    wordCount: isMac ? '⌘⇧W' : 'Ctrl+Shift+W',
    statusBar: isMac ? '⌘⇧B' : 'Ctrl+Shift+B',
    autoSave: isMac ? '⌘⇧A' : 'Ctrl+Shift+A'
  };
  
  const outlineShortcut = document.getElementById('shortcut-outline');
  const wordCountShortcut = document.getElementById('shortcut-word-count');
  const statusBarShortcut = document.getElementById('shortcut-status-bar');
  const autoSaveShortcut = document.getElementById('shortcut-auto-save');
  
  if (outlineShortcut) outlineShortcut.textContent = shortcuts.outline;
  if (wordCountShortcut) wordCountShortcut.textContent = shortcuts.wordCount;
  if (statusBarShortcut) statusBarShortcut.textContent = shortcuts.statusBar;
  if (autoSaveShortcut) autoSaveShortcut.textContent = shortcuts.autoSave;
}

// Load and apply settings
async function loadSettings() {
  const settings = await ipcRenderer.invoke('get-settings');
  await applySettings(settings);
  
  // Apply view options from settings
  if (settings.viewOptions) {
    outlineVisible = settings.viewOptions.showOutline || false;
    wordCountVisible = settings.viewOptions.showWordCount || false;
    statusBarVisible = settings.viewOptions.showStatusBar !== false;
    
    // Apply visibility
    const outlinePanel = document.getElementById('outline-panel');
    if (outlinePanel) {
      if (outlineVisible) {
        outlinePanel.classList.remove('hidden');
        updateOutline();
      } else {
        outlinePanel.classList.add('hidden');
      }
    }
    
    // Word count visibility controls status bar word count
    const statusWordCount = document.getElementById('status-word-count');
    if (statusWordCount) {
      if (wordCountVisible) {
        statusWordCount.style.display = '';
        updateWordCount();
      } else {
        statusWordCount.style.display = 'none';
      }
    }
    
    const statusBar = document.getElementById('status-bar');
    const mainContent = document.querySelector('.main-content');
    if (statusBar) {
      if (statusBarVisible) {
        statusBar.classList.remove('hidden');
        if (mainContent) {
          mainContent.classList.remove('no-status-bar');
        }
      } else {
        statusBar.classList.add('hidden');
        if (mainContent) {
          mainContent.classList.add('no-status-bar');
        }
      }
    }
  }
}

// Settings tab management
function openSettingsTab() {
  // Check if settings tab already exists
  if (settingsTabId) {
    const settingsTab = tabs.find(t => t.id === settingsTabId);
    if (settingsTab) {
      switchTab(settingsTabId);
      return;
    }
  }
  
  // Create settings tab
  settingsTabId = `tab-${++tabIdCounter}`;
  const tab = {
    id: settingsTabId,
    filePath: null,
    content: '',
    modified: false,
    model: null,
    isSettings: true
  };
  
  tabs.push(tab);
  activeTabId = settingsTabId;
  
  // Hide editor, show settings
  const editorContainer = document.getElementById('editor-container');
  const settingsContainer = document.getElementById('settings-container');
  
  if (editorContainer) editorContainer.style.display = 'none';
  if (settingsContainer) {
    settingsContainer.classList.remove('hidden');
    loadSettingsIntoForm();
    // Setup form listeners when opening settings tab
    setupSettingsForm();
  }
  
  renderTabs();
}

function closeSettingsTab() {
  if (!settingsTabId) return;
  
  const tabIndex = tabs.findIndex(t => t.id === settingsTabId);
  if (tabIndex !== -1) {
    tabs.splice(tabIndex, 1);
  }
  
  settingsTabId = null;
  
  // Clear currentSettings so updateWordCount uses saved settings from disk
  // Only clear if we're not saving (if saving, originalSettings will be updated)
  if (originalSettings) {
    // After closing, use saved settings (originalSettings matches saved settings after save)
    currentSettings = null;
  }
  
  // Show editor, hide settings
  const editorContainer = document.getElementById('editor-container');
  const settingsContainer = document.getElementById('settings-container');
  
  if (editorContainer) editorContainer.style.display = '';
  if (settingsContainer) settingsContainer.classList.add('hidden');
  
  // Update word count with saved settings
  updateWordCount();
  
  // Switch to another tab or create new one
  if (tabs.length > 0) {
    switchTab(tabs[0].id);
  } else {
    createNewTab();
  }
}

function loadSettingsIntoForm() {
  ipcRenderer.invoke('get-settings').then(settings => {
    // Ensure viewOptions exist in settings (for backward compatibility)
    if (!settings.viewOptions) {
      settings.viewOptions = {
        showOutline: outlineVisible,
        showWordCount: wordCountVisible,
        showStatusBar: statusBarVisible
      };
    }
    
    // Always load fresh settings from disk when opening settings tab
    // This ensures we start with the currently saved settings
    originalSettings = JSON.parse(JSON.stringify(settings)); // Deep copy - these are the saved settings
    currentSettings = JSON.parse(JSON.stringify(settings)); // Start with same as original
    
    // Load form values
    loadFormValues(settings);
    
    // Update shortcut display
    updateShortcutDisplay();
  });
}

function loadFormValues(settings) {
  // Load editor settings into form
  const fontSizeEl = document.getElementById('settings-fontSize');
  const themeEl = document.getElementById('settings-theme');
  const wordWrapEl = document.getElementById('settings-wordWrap');
  const minimapEl = document.getElementById('settings-minimap');
  const lineNumbersEl = document.getElementById('settings-lineNumbers');
  const autoSaveEl = document.getElementById('settings-autoSave');
  const autoSaveIntervalEl = document.getElementById('settings-autoSaveInterval');
  
  if (fontSizeEl) fontSizeEl.value = settings.fontSize || 14;
  if (themeEl) themeEl.value = settings.theme || 'vs-dark';
  if (wordWrapEl) wordWrapEl.value = settings.wordWrap || 'on';
  if (minimapEl) minimapEl.checked = settings.minimap !== false;
  if (lineNumbersEl) lineNumbersEl.checked = settings.lineNumbers !== false;
  if (autoSaveEl) autoSaveEl.checked = settings.autoSave !== false;
  if (autoSaveIntervalEl) autoSaveIntervalEl.value = (settings.autoSaveInterval || 1000) / 1000;
  
  // Load word count options
  const wordCountOptions = settings.wordCountOptions || {};
  const showChineseEl = document.getElementById('settings-showChineseWordCount');
  const showEnglishEl = document.getElementById('settings-showEnglishWordCount');
  const showTotalEl = document.getElementById('settings-showTotalWordCount');
  const showCharEl = document.getElementById('settings-showCharacterCount');
  const showBreakdownEl = document.getElementById('settings-showWordCountBreakdown');
  const showLineEl = document.getElementById('settings-showLineCount');
  const showParaEl = document.getElementById('settings-showParagraphCount');
  
  if (showChineseEl) showChineseEl.checked = wordCountOptions.showChineseWordCount !== false;
  if (showEnglishEl) showEnglishEl.checked = wordCountOptions.showEnglishWordCount !== false;
  if (showTotalEl) showTotalEl.checked = wordCountOptions.showTotalWordCount !== false;
  if (showCharEl) showCharEl.checked = wordCountOptions.showCharacterCount !== false;
  if (showBreakdownEl) showBreakdownEl.checked = wordCountOptions.showWordCountBreakdown !== false;
  if (showLineEl) showLineEl.checked = wordCountOptions.showLineCount || false;
  if (showParaEl) showParaEl.checked = wordCountOptions.showParagraphCount || false;
  
  // Load view options
  const viewOptions = settings.viewOptions || {};
  const showOutlineEl = document.getElementById('settings-showOutline');
  const showWordCountViewEl = document.getElementById('settings-showWordCount');
  const showStatusBarEl = document.getElementById('settings-showStatusBar');
  
  // Get current state if settings don't have viewOptions yet
  if (showOutlineEl) showOutlineEl.checked = viewOptions.showOutline !== undefined ? viewOptions.showOutline : outlineVisible;
  if (showWordCountViewEl) showWordCountViewEl.checked = viewOptions.showWordCount !== undefined ? viewOptions.showWordCount : wordCountVisible;
  if (showStatusBarEl) showStatusBarEl.checked = viewOptions.showStatusBar !== undefined ? viewOptions.showStatusBar : statusBarVisible;
  
  // Update shortcut display based on platform
  updateShortcutDisplay();
}

function setupSettingsForm() {
  // Setup save button
  const saveBtn = document.getElementById('settings-saveBtn');
  const cancelBtn = document.getElementById('settings-cancelBtn');
  
  if (saveBtn) {
    // Clone and replace to remove old listeners
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    
    newSaveBtn.addEventListener('click', async () => {
      // Get current settings from form
      const settings = getSettingsFromForm();
      
      // Save to disk
      const result = await ipcRenderer.invoke('save-settings', settings);
      if (result.success) {
        // Update original settings to match saved settings
        originalSettings = JSON.parse(JSON.stringify(settings));
        // Clear currentSettings so normal operation uses saved settings from disk
        currentSettings = null;
        
        // Clear modified flag on settings tab
        const settingsTab = tabs.find(t => t.id === settingsTabId);
        if (settingsTab) {
          settingsTab.modified = false;
          renderTabs();
        }
        
        console.log('Settings saved successfully');
        
        // Update word count with newly saved settings
        updateWordCount();
        
        // Settings are now saved, close the tab
        closeSettingsTab();
      }
    });
  }
  
  if (cancelBtn) {
    // Clone and replace to remove old listeners
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newCancelBtn.addEventListener('click', () => {
      // Revert to original settings (the saved settings from disk)
      if (originalSettings) {
        console.log('Reverting to original settings');
        
        // Restore form values to original settings
        loadFormValues(originalSettings);
        
        // Apply original settings to editor immediately (including view options)
        applySettings(originalSettings);
        
        // Clear currentSettings so it uses saved settings from disk
        currentSettings = null;
        
        // Clear modified flag on settings tab
        const settingsTab = tabs.find(t => t.id === settingsTabId);
        if (settingsTab) {
          settingsTab.modified = false;
          renderTabs();
        }
        
        // Update word count with original (saved) settings
        updateWordCount();
      }
      
      // Close settings tab
      closeSettingsTab();
    });
  }
  
  // Apply settings immediately on change (live preview)
  const inputIds = [
    'settings-fontSize', 'settings-theme', 'settings-wordWrap',
    'settings-minimap', 'settings-lineNumbers', 'settings-autoSave',
    'settings-autoSaveInterval',
    'settings-showChineseWordCount', 'settings-showEnglishWordCount',
    'settings-showTotalWordCount', 'settings-showCharacterCount',
    'settings-showWordCountBreakdown', 'settings-showLineCount',
    'settings-showParagraphCount',
    'settings-showOutline', 'settings-showWordCount', 'settings-showStatusBar'
  ];
  
  inputIds.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      // For checkboxes, use both 'change' and 'click' to ensure immediate update
      // For number inputs, use 'input' for real-time updates
      // For selects, use 'change'
      let eventTypes = [];
      if (element.type === 'checkbox') {
        eventTypes = ['change', 'click'];
      } else if (element.type === 'number' || element.type === 'text') {
        eventTypes = ['input', 'change'];
      } else {
        eventTypes = ['change'];
      }
      
      // Add event listeners for live preview
      eventTypes.forEach(eventType => {
        element.addEventListener(eventType, () => {
          console.log('Setting changed:', id, 'event:', eventType);
          
          // Get current form values
          const settings = getSettingsFromForm();
          
          // Store as current preview settings
          currentSettings = JSON.parse(JSON.stringify(settings));
          
          // Check if settings are modified and update tab
          if (originalSettings) {
            const settingsChanged = JSON.stringify(currentSettings) !== JSON.stringify(originalSettings);
            const settingsTab = tabs.find(t => t.id === settingsTabId);
            if (settingsTab) {
              settingsTab.modified = settingsChanged;
              renderTabs();
            }
          }
          
          // Apply immediately (live preview)
          applySettings(settings);
          
          // Update word count with preview settings immediately
          // This ensures word count options apply right away
          updateWordCount();
          
          console.log('Settings preview applied');
        });
      });
    } else {
      console.warn('Element not found:', id);
    }
  });
}

function getSettingsFromForm() {
  return {
    fontSize: parseInt(document.getElementById('settings-fontSize').value),
    theme: document.getElementById('settings-theme').value,
    wordWrap: document.getElementById('settings-wordWrap').value,
    minimap: document.getElementById('settings-minimap').checked,
    lineNumbers: document.getElementById('settings-lineNumbers').checked,
    autoSave: document.getElementById('settings-autoSave').checked,
    autoSaveInterval: parseInt(document.getElementById('settings-autoSaveInterval').value) * 1000,
    wordCountOptions: {
      showChineseWordCount: document.getElementById('settings-showChineseWordCount').checked,
      showEnglishWordCount: document.getElementById('settings-showEnglishWordCount').checked,
      showTotalWordCount: document.getElementById('settings-showTotalWordCount').checked,
      showCharacterCount: document.getElementById('settings-showCharacterCount').checked,
      showWordCountBreakdown: document.getElementById('settings-showWordCountBreakdown').checked,
      showLineCount: document.getElementById('settings-showLineCount').checked,
      showParagraphCount: document.getElementById('settings-showParagraphCount').checked
    },
    viewOptions: {
      showOutline: document.getElementById('settings-showOutline').checked,
      showWordCount: document.getElementById('settings-showWordCount').checked,
      showStatusBar: document.getElementById('settings-showStatusBar').checked
    }
  };
}

async function applySettings(settings) {
  // Apply editor settings (only if editor exists)
  if (editor) {
    // Apply theme separately using setTheme
    if (settings.theme) {
      monaco.editor.setTheme(settings.theme);
    }
    
    // Apply other editor options
    editor.updateOptions({
      fontSize: settings.fontSize || 14,
      wordWrap: settings.wordWrap || 'on',
      minimap: { enabled: settings.minimap !== false },
      lineNumbers: settings.lineNumbers !== false ? 'on' : 'off'
    });
  }
  
  // Apply theme to settings container immediately
  const settingsContainer = document.getElementById('settings-container');
  const settingsContent = settingsContainer?.querySelector('.settings-content');
  if (settingsContainer && settingsContent) {
    const theme = settings.theme || 'vs-dark';
    
    // Remove all theme classes
    settingsContainer.classList.remove('theme-vs-dark', 'theme-vs', 'theme-hc-black');
    settingsContent.classList.remove('theme-vs-dark', 'theme-vs', 'theme-hc-black');
    
    // Add current theme class
    const themeClass = `theme-${theme}`;
    settingsContainer.classList.add(themeClass);
    settingsContent.classList.add(themeClass);
    
    // Apply theme colors immediately using CSS classes (CSS will handle the styling)
    // The CSS classes defined in settings.css will handle the color changes
  }
  
  // Apply auto-save settings
  autoSaveEnabled = settings.autoSave !== false;
  if (autoSaveEnabled) {
    stopAutoSave();
    // Update interval if changed
    if (settings.autoSaveInterval) {
      startAutoSave();
    } else {
      startAutoSave();
    }
  } else {
    stopAutoSave();
  }
  
  // Update status bar
  updateAutoSaveStatus();
  
  // Apply view options
  if (settings.viewOptions) {
    const viewOpts = settings.viewOptions;
    
    // Apply outline visibility
    if (viewOpts.showOutline !== undefined) {
      outlineVisible = viewOpts.showOutline;
      const outlinePanel = document.getElementById('outline-panel');
      if (outlinePanel) {
        if (outlineVisible) {
          outlinePanel.classList.remove('hidden');
          updateOutline();
        } else {
          outlinePanel.classList.add('hidden');
        }
      }
    }
    
    // Apply word count visibility (controls status bar word count, not floating element)
    if (viewOpts.showWordCount !== undefined) {
      wordCountVisible = viewOpts.showWordCount;
      const statusWordCount = document.getElementById('status-word-count');
      if (statusWordCount) {
        if (wordCountVisible) {
          statusWordCount.style.display = '';
          updateWordCount();
        } else {
          statusWordCount.style.display = 'none';
        }
      }
    }
    
    // Apply status bar visibility
    if (viewOpts.showStatusBar !== undefined) {
      statusBarVisible = viewOpts.showStatusBar;
      const statusBar = document.getElementById('status-bar');
      const mainContent = document.querySelector('.main-content');
      if (statusBar) {
        if (statusBarVisible) {
          statusBar.classList.remove('hidden');
          if (mainContent) {
            mainContent.classList.remove('no-status-bar');
          }
        } else {
          statusBar.classList.add('hidden');
          if (mainContent) {
            mainContent.classList.add('no-status-bar');
          }
        }
      }
    }
  }
}

// Don't setup event listeners immediately - wait for editor to be ready
// Event listeners will be set up after editor is fully initialized

// Parse headings from content and generate outline
function parseHeadings(content) {
  const headings = [];
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Check for markdown-style headings (# ## ### etc.)
    const markdownMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (markdownMatch) {
      const level = markdownMatch[1].length;
      const text = markdownMatch[2].trim();
      headings.push({
        level: level,
        text: text,
        line: lineNum
      });
      return;
    }
    
    // Check for underline-style headings (=== or ---)
    if (index > 0) {
      const prevLine = lines[index - 1].trim();
      if (prevLine.length > 0) {
        if (line.match(/^=+$/)) {
          headings.push({
            level: 1,
            text: prevLine,
            line: index
          });
          return;
        }
        if (line.match(/^-+$/)) {
          headings.push({
            level: 2,
            text: prevLine,
            line: index
          });
          return;
        }
      }
    }
    
    // Check for numbered headings (1. 2. etc.) or letter headings (A. B. etc.)
    const numberedMatch = line.match(/^(\d+|[A-Z])\.\s+(.+)$/);
    if (numberedMatch && line.length < 100) {
      headings.push({
        level: 3,
        text: numberedMatch[2].trim(),
        line: lineNum
      });
    }
  });
  
  return headings;
}

// Update outline panel
function updateOutline() {
  if (!editor) return;
  
  const content = editor.getValue();
  const headings = parseHeadings(content);
  outlineItems = headings;
  
  const outlineContent = document.getElementById('outline-content');
  if (!outlineContent) return;
  
  if (headings.length === 0) {
    outlineContent.innerHTML = '<div style="padding: 10px; color: #666; font-style: italic;">No headings found</div>';
    return;
  }
  
  outlineContent.innerHTML = headings.map((heading, index) => {
    return `<div class="outline-item h${heading.level}" data-line="${heading.line}" data-index="${index}">${escapeHtml(heading.text)}</div>`;
  }).join('');
  
  // Add click handlers
  outlineContent.querySelectorAll('.outline-item').forEach(item => {
    item.addEventListener('click', () => {
      const line = parseInt(item.getAttribute('data-line'));
      if (editor && line > 0) {
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.revealLineInCenter(line);
        editor.focus();
        
        // Update active state
        outlineContent.querySelectorAll('.outline-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      }
    });
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Tab management functions
function createNewTab(filePath = null, content = '') {
  // If filePath is provided, check if file is already open
  if (filePath) {
    const existingTab = tabs.find(t => t.filePath === filePath);
    if (existingTab) {
      // Switch to existing tab instead of creating duplicate
      switchTab(existingTab.id);
      return existingTab.id;
    }
  }
  
  const tabId = `tab-${++tabIdCounter}`;
  const path = (window.nodeRequire || require)('path');
  
  // Find next available "New Tab" number if this is a new tab (no filePath)
  let newTabNumber = null;
  if (!filePath) {
    // Get all existing "New Tab" numbers
    const existingNumbers = tabs
      .filter(t => !t.filePath && !t.isSettings && t.newTabNumber)
      .map(t => t.newTabNumber)
      .sort((a, b) => a - b);
    
    // Find the first available number starting from 2 (1 is for "New Tab")
    let nextNumber = 2;
    for (const num of existingNumbers) {
      if (num === nextNumber) {
        nextNumber++;
      } else {
        break;
      }
    }
    
    // Check if "New Tab" (without number) exists
    const hasNewTab = tabs.some(t => !t.filePath && !t.isSettings && !t.newTabNumber);
    
    if (hasNewTab) {
      // "New Tab" exists, use nextNumber
      newTabNumber = nextNumber;
    } else {
      // No "New Tab" exists, this will be "New Tab" (no number)
      newTabNumber = null;
    }
  }
  
  const tab = {
    id: tabId,
    filePath: filePath,
    content: content,
    modified: false,
    model: null,
    newTabNumber: newTabNumber
  };
  
  tabs.push(tab);
  activeTabId = tabId;
  
  // Hide default view, show editor
  const defaultView = document.getElementById('default-view');
  const editorContainer = document.getElementById('editor-container');
  if (defaultView) defaultView.classList.add('hidden');
  if (editorContainer) editorContainer.style.display = '';
  
  // Initialize last saved content for this tab
  if (filePath) {
    lastSavedContent[tabId] = content;
  }
  
  // Create Monaco model for this tab
  if (editor) {
    const model = monaco.editor.createModel(content, 'plaintext');
    editor.setModel(model);
    tab.model = model;
  }
  
  renderTabs();
  updateWordCount();
  updateOutline();
  
  if (editor) {
    setTimeout(() => editor.focus(), 100);
  }
  
  return tabId;
}

function switchTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  
  // Handle settings tab
  if (tab.isSettings) {
    activeTabId = tabId;
    const editorContainer = document.getElementById('editor-container');
    const settingsContainer = document.getElementById('settings-container');
    
    if (editorContainer) editorContainer.style.display = 'none';
    if (settingsContainer) {
      settingsContainer.classList.remove('hidden');
      if (!originalSettings) {
        loadSettingsIntoForm();
        setupSettingsForm();
      }
    }
    renderTabs();
    return;
  }
  
  if (!editor) return;
  
  // Save current tab content
  if (activeTabId) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab && !currentTab.isSettings) {
      const content = editor.getValue();
      currentTab.content = content;
      // Update last saved content if tab has a file path
      if (currentTab.filePath) {
        lastSavedContent[activeTabId] = content;
      }
    }
  }
  
  activeTabId = tabId;
  
  // Hide settings and default view, show editor
  const editorContainer = document.getElementById('editor-container');
  const settingsContainer = document.getElementById('settings-container');
  const defaultView = document.getElementById('default-view');
  
  if (editorContainer) editorContainer.style.display = '';
  if (settingsContainer) settingsContainer.classList.add('hidden');
  if (defaultView) defaultView.classList.add('hidden');
  
  // Switch to tab's model
  if (tab.model) {
    editor.setModel(tab.model);
  } else {
    const model = monaco.editor.createModel(tab.content, 'plaintext');
    editor.setModel(model);
    tab.model = model;
  }
  
  renderTabs();
  updateWordCount();
  updateOutline();
  editor.focus();
}

function closeTab(tabId) {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;
  
  const tab = tabs[tabIndex];
  
  // Handle settings tab - always revert to original settings when closing without save
  if (tab.isSettings) {
    // Revert to original settings if they were changed
    if (originalSettings) {
      const settingsChanged = currentSettings && JSON.stringify(currentSettings) !== JSON.stringify(originalSettings);
      if (settingsChanged) {
        // Restore form values to original settings
        loadFormValues(originalSettings);
        // Apply original settings to editor
        applySettings(originalSettings);
        // Clear currentSettings so it uses saved settings from disk
        currentSettings = null;
        // Update word count with original (saved) settings
        updateWordCount();
      } else {
        // No changes made, just clear currentSettings
        currentSettings = null;
      }
    }
    settingsTabId = null;
    
    // Clear modified flag
    tab.modified = false;
    
    // Hide settings container
    const settingsContainer = document.getElementById('settings-container');
    if (settingsContainer) {
      settingsContainer.classList.add('hidden');
    }
    const editorContainer = document.getElementById('editor-container');
    if (editorContainer) {
      editorContainer.style.display = '';
    }
  }
  
  // Dispose Monaco model (only for editor tabs)
  if (tab.model && !tab.isSettings) {
    tab.model.dispose();
  }
  
  tabs.splice(tabIndex, 1);
  
  // If closed tab was active, switch to another tab
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      // Switch to next tab, or previous if it was the last
      const newIndex = Math.min(tabIndex, tabs.length - 1);
      switchTab(tabs[newIndex].id);
    } else {
      // No tabs left, show default view
      showDefaultView();
    }
  } else {
    renderTabs();
  }
}

function renderTabs() {
  const tabsList = document.getElementById('tabs-list');
  if (!tabsList) return;
  
  const path = (window.nodeRequire || require)('path');
  
  tabsList.innerHTML = tabs.map(tab => {
    let title;
    if (tab.isSettings) {
      title = 'Settings';
    } else if (tab.filePath) {
      title = path.basename(tab.filePath);
    } else {
      // "New Tab" with number if applicable
      title = tab.newTabNumber ? `New Tab ${tab.newTabNumber}` : 'New Tab';
    }
    // Show * for modified tabs (including settings tab)
    const modified = tab.modified ? '*' : '';
    const activeClass = tab.id === activeTabId ? 'active' : '';
    return `
      <div class="tab ${activeClass}" data-tab-id="${tab.id}">
        <span class="tab-title">${escapeHtml(title)}${modified}</span>
        <span class="tab-close" data-tab-id="${tab.id}">×</span>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  tabsList.querySelectorAll('.tab').forEach(tabEl => {
    const tabId = tabEl.getAttribute('data-tab-id');
    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        closeTab(tabId);
      } else {
        switchTab(tabId);
      }
    });
  });
}

function updateTabTitle(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  
  const path = (window.nodeRequire || require)('path');
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) {
    let title;
    if (tab.isSettings) {
      title = 'Settings';
    } else if (tab.filePath) {
      title = path.basename(tab.filePath);
    } else {
      title = tab.newTabNumber ? `New Tab ${tab.newTabNumber}` : 'New Tab';
    }
    const modified = tab.modified ? '*' : '';
    const titleEl = tabEl.querySelector('.tab-title');
    if (titleEl) {
      titleEl.textContent = `${title}${modified}`;
    }
  }
}

function showDefaultView() {
  activeTabId = null;
  
  // Hide editor and settings, show default view
  const editorContainer = document.getElementById('editor-container');
  const settingsContainer = document.getElementById('settings-container');
  const defaultView = document.getElementById('default-view');
  
  if (editorContainer) editorContainer.style.display = 'none';
  if (settingsContainer) settingsContainer.classList.add('hidden');
  if (defaultView) defaultView.classList.remove('hidden');
  
  renderTabs();
}

function saveOpenFiles() {
  const openFiles = tabs.map(tab => ({
    filePath: tab.filePath,
    content: tab.content,
    modified: tab.modified
  }));
  ipcRenderer.invoke('save-open-files', openFiles);
}

async function restoreOpenFiles() {
  const openFiles = await ipcRenderer.invoke('get-open-files');
  if (openFiles && openFiles.length > 0) {
    const seenPaths = new Set(); // Track files we've already restored
    
    for (const file of openFiles) {
      if (file.filePath) {
        // Skip if we've already restored this file (avoid duplicates)
        if (seenPaths.has(file.filePath)) {
          continue;
        }
        seenPaths.add(file.filePath);
        
        try {
          const content = await ipcRenderer.invoke('read-file', file.filePath);
          if (content.success) {
            const tabId = createNewTab(file.filePath, content.data);
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
              tab.modified = file.modified || false;
              // Initialize last saved content with the restored content
              lastSavedContent[tabId] = content.data;
            }
          }
        } catch (error) {
          console.error('Error restoring file:', error);
        }
      } else if (file.content) {
        // Restore untitled tabs with content (only one untitled tab)
        // Check if we already have an untitled tab
        const hasUntitled = tabs.some(t => !t.filePath);
        if (!hasUntitled) {
          const tabId = createNewTab(null, file.content);
          const tab = tabs.find(t => t.id === tabId);
          if (tab) {
            tab.modified = file.modified || false;
          }
        }
      }
    }
  }
}

// Cleanup on window close
window.addEventListener('beforeunload', () => {
  // Save current tab content
  if (activeTabId && editor) {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab) {
      activeTab.content = editor.getValue();
    }
  }
  
  // Save open files list
  saveOpenFiles();
  
  // Dispose all models
  tabs.forEach(tab => {
    if (tab.model) {
      tab.model.dispose();
    }
  });
  
  stopAutoSave();
  if (editor) {
    editor.dispose();
  }
});
