// Use Node's require (saved before Monaco loader)
const { ipcRenderer } = (window.nodeRequire || require)('electron');
const process = (window.nodeRequire || require)('process');

let editor;
let autoSaveInterval;
let autoSaveEnabled = true; // Auto-save is enabled by default
let wordCountVisible = false;
let outlineVisible = false;
let statusBarVisible = true; // Status bar visible by default
let previewVisible = false; // Preview pane visibility
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

      // Get language mode from settings (default to plaintext)
      let initialLanguage = 'plaintext';
      // Try to get from settings if available
      if (typeof window !== 'undefined' && window.currentSettings) {
        initialLanguage = window.currentSettings.languageMode || 'plaintext';
      }
      
      editor = monaco.editor.create(container, {
        value: '',
        language: initialLanguage,
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
        if (previewVisible) {
          updatePreview(); // Update preview in real-time
        }
      });

      // Update format bar state on selection change
      editor.onDidChangeCursorSelection(() => {
        updateFormatBarState();
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

  // Format bar event listeners
  setupFormatBarListeners();
}

// Format bar functions
function setupFormatBarListeners() {
  // Setup listeners even if editor isn't ready yet - they'll work when editor is available

  // Format style dropdown
  const formatStyle = document.getElementById('format-style');
  if (formatStyle) {
    formatStyle.addEventListener('change', (e) => {
      applyFormatStyle(e.target.value);
    });
  }

  // Bold button
  const formatBold = document.getElementById('format-bold');
  if (formatBold) {
    formatBold.addEventListener('click', () => {
      applyBold();
    });
  }

  // Italic button
  const formatItalic = document.getElementById('format-italic');
  if (formatItalic) {
    formatItalic.addEventListener('click', () => {
      applyItalic();
    });
  }

  // Underline button
  const formatUnderline = document.getElementById('format-underline');
  if (formatUnderline) {
    formatUnderline.addEventListener('click', () => {
      applyUnderline();
    });
  }

  // Bullet list button
  const formatListUl = document.getElementById('format-list-ul');
  if (formatListUl) {
    formatListUl.addEventListener('click', () => {
      applyBulletList();
    });
  }

  // Numbered list button
  const formatListOl = document.getElementById('format-list-ol');
  if (formatListOl) {
    formatListOl.addEventListener('click', () => {
      applyNumberedList();
    });
  }

  // Toggle preview button
  const togglePreview = document.getElementById('toggle-preview');
  if (togglePreview) {
    togglePreview.addEventListener('click', () => {
      togglePreviewPane();
    });
  }

  // Format bar color pickers
  const formatFontColor = document.getElementById('format-fontColor');
  const formatFontColorHex = document.getElementById('format-fontColor-hex');
  const formatBackgroundColor = document.getElementById('format-backgroundColor');
  const formatBackgroundColorHex = document.getElementById('format-backgroundColor-hex');
  
  if (formatFontColor) {
    formatFontColor.addEventListener('change', () => {
      applyColorToEditor('fontColor', formatFontColor.value);
      syncFormatBarToSettings();
    });
  }
  if (formatFontColorHex) {
    formatFontColorHex.addEventListener('input', () => {
      const hexValue = formatFontColorHex.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(hexValue) && formatFontColor) {
        formatFontColor.value = hexValue;
        applyColorToEditor('fontColor', hexValue);
        syncFormatBarToSettings();
      }
    });
    formatFontColorHex.addEventListener('blur', () => {
      const hexValue = formatFontColorHex.value.trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(hexValue) && formatFontColor) {
        formatFontColorHex.value = formatFontColor.value;
      }
    });
  }
  if (formatBackgroundColor) {
    formatBackgroundColor.addEventListener('change', () => {
      applyColorToEditor('backgroundColor', formatBackgroundColor.value);
      syncFormatBarToSettings();
    });
  }
  if (formatBackgroundColorHex) {
    formatBackgroundColorHex.addEventListener('input', () => {
      const hexValue = formatBackgroundColorHex.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(hexValue) && formatBackgroundColor) {
        formatBackgroundColor.value = hexValue;
        applyColorToEditor('backgroundColor', hexValue);
        syncFormatBarToSettings();
      }
    });
    formatBackgroundColorHex.addEventListener('blur', () => {
      const hexValue = formatBackgroundColorHex.value.trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(hexValue) && formatBackgroundColor) {
        formatBackgroundColorHex.value = formatBackgroundColor.value;
      }
    });
  }

  // Update format bar state on selection change (will be set up when editor is ready)
  // This is handled in initializeEditor after editor is created

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
      // Shift+Command/Ctrl shortcuts
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePreviewPane();
      }
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      // Command/Ctrl shortcuts
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        applyBold();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        applyItalic();
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        applyUnderline();
      }
    }
  });
}

function getSelectedText() {
  if (!editor) return { text: '', start: 0, end: 0 };
  
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    // No selection, get current line
    const position = editor.getPosition();
    const line = editor.getModel().getLineContent(position.lineNumber);
    const start = editor.getModel().getOffsetAt({ lineNumber: position.lineNumber, column: 1 });
    const end = start + line.length;
    return { text: line, start, end, lineNumber: position.lineNumber, isLine: true };
  }
  
  const text = editor.getModel().getValueInRange(selection);
  const start = editor.getModel().getOffsetAt(selection.getStartPosition());
  const end = editor.getModel().getOffsetAt(selection.getEndPosition());
  
  return { text, start, end, selection, isLine: false };
}

function replaceText(start, end, newText, selectNewText = false) {
  if (!editor) return;
  
  const model = editor.getModel();
  const startPos = model.getPositionAt(start);
  const endPos = model.getPositionAt(end);
  
  const Range = monaco.Range;
  editor.executeEdits('format', [{
    range: new Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
    text: newText
  }]);
  
  if (selectNewText) {
    const newEnd = start + newText.length;
    const newEndPos = model.getPositionAt(newEnd);
    editor.setSelection(new Range(startPos.lineNumber, startPos.column, newEndPos.lineNumber, newEndPos.column));
  } else {
    // Place cursor at end of replacement
    const newEnd = start + newText.length;
    const newEndPos = model.getPositionAt(newEnd);
    editor.setPosition(newEndPos);
  }
}

function applyFormatStyle(style) {
  const selected = getSelectedText();
  if (!selected.text && !selected.isLine) return;
  
  let formattedText = selected.text.trim();
  const model = editor.getModel();
  
  if (selected.isLine) {
    // Apply to entire line
    const lineNumber = selected.lineNumber;
    const line = model.getLineContent(lineNumber);
    const lineStart = model.getOffsetAt({ lineNumber, column: 1 });
    const lineEnd = lineStart + line.length;
    
    let prefix = '';
    let suffix = '';
    
    // Remove existing markdown formatting
    formattedText = line.replace(/^#+\s*/, '').trim();
    
    switch (style) {
      case 'title':
        prefix = '# ';
        break;
      case 'h1':
        prefix = '# ';
        break;
      case 'h2':
        prefix = '## ';
        break;
      case 'h3':
        prefix = '### ';
        break;
      case 'normal':
        prefix = '';
        break;
    }
    
    const newText = prefix + formattedText;
    replaceText(lineStart, lineEnd, newText);
  } else {
    // Apply to selected text
    let prefix = '';
    
    switch (style) {
      case 'title':
        prefix = '# ';
        break;
      case 'h1':
        prefix = '# ';
        break;
      case 'h2':
        prefix = '## ';
        break;
      case 'h3':
        prefix = '### ';
        break;
      case 'normal':
        // Remove markdown formatting if present
        formattedText = formattedText.replace(/^#+\s*/, '');
        break;
    }
    
    const newText = prefix + formattedText;
    replaceText(selected.start, selected.end, newText, true);
  }
  
  updateFormatBarState();
}

function applyBold() {
  const selected = getSelectedText();
  if (!selected.text && !selected.isLine) return;
  
  let text = selected.text.trim();
  const isBold = text.startsWith('**') && text.endsWith('**') && text.length > 4;
  
  if (isBold) {
    // Remove bold
    text = text.slice(2, -2);
  } else {
    // Add bold
    text = `**${text}**`;
  }
  
  replaceText(selected.start, selected.end, text, true);
  updateFormatBarState();
}

function applyItalic() {
  const selected = getSelectedText();
  if (!selected.text && !selected.isLine) return;
  
  let text = selected.text.trim();
  const isItalic = (text.startsWith('*') && text.endsWith('*') && !text.startsWith('**')) || 
                   (text.startsWith('_') && text.endsWith('_') && !text.startsWith('__'));
  
  if (isItalic) {
    // Remove italic
    text = text.replace(/^[*_]|[*_]$/g, '');
  } else {
    // Add italic
    text = `*${text}*`;
  }
  
  replaceText(selected.start, selected.end, text, true);
  updateFormatBarState();
}

function applyUnderline() {
  const selected = getSelectedText();
  if (!selected.text && !selected.isLine) return;
  
  let text = selected.text.trim();
  // Markdown doesn't have native underline, so we'll use HTML or just add emphasis
  // For now, we'll use a workaround with emphasis
  const hasUnderline = text.includes('<u>') || text.startsWith('_') && text.endsWith('_');
  
  if (hasUnderline) {
    // Remove underline
    text = text.replace(/<u>|<\/u>/g, '').replace(/^_|_$/g, '');
  } else {
    // Add underline (using HTML since markdown doesn't support it natively)
    text = `<u>${text}</u>`;
  }
  
  replaceText(selected.start, selected.end, text, true);
  updateFormatBarState();
}

function applyBulletList() {
  const selected = getSelectedText();
  if (!selected.text && !selected.isLine) return;
  
  const lines = selected.text.split('\n');
  const isList = lines.every(line => line.trim().startsWith('- ') || line.trim().startsWith('* '));
  
  if (isList) {
    // Remove list markers
    const newLines = lines.map(line => line.replace(/^[\s]*[-*]\s+/, ''));
    replaceText(selected.start, selected.end, newLines.join('\n'));
  } else {
    // Add list markers
    const newLines = lines.map(line => line.trim() ? `- ${line.trim()}` : line);
    replaceText(selected.start, selected.end, newLines.join('\n'));
  }
  
  updateFormatBarState();
}

function applyNumberedList() {
  const selected = getSelectedText();
  if (!selected.text && !selected.isLine) return;
  
  const lines = selected.text.split('\n');
  const isList = lines.every(line => /^\s*\d+\.\s+/.test(line.trim()));
  
  if (isList) {
    // Remove list markers
    const newLines = lines.map(line => line.replace(/^\s*\d+\.\s+/, ''));
    replaceText(selected.start, selected.end, newLines.join('\n'));
  } else {
    // Add numbered list markers
    const newLines = lines.map((line, index) => {
      if (line.trim()) {
        return `${index + 1}. ${line.trim()}`;
      }
      return line;
    });
    replaceText(selected.start, selected.end, newLines.join('\n'));
  }
  
  updateFormatBarState();
}

function updateFormatBarState() {
  if (!editor) return;
  
  const selected = getSelectedText();
  const formatStyle = document.getElementById('format-style');
  const formatBold = document.getElementById('format-bold');
  const formatItalic = document.getElementById('format-italic');
  const formatUnderline = document.getElementById('format-underline');
  
  // Update style dropdown
  if (formatStyle && selected.text) {
    const text = selected.text.trim();
    if (text.startsWith('### ')) {
      formatStyle.value = 'h3';
    } else if (text.startsWith('## ')) {
      formatStyle.value = 'h2';
    } else if (text.startsWith('# ')) {
      formatStyle.value = 'h1';
    } else {
      formatStyle.value = 'normal';
    }
  }
  
  // Update button states
  if (selected.text) {
    const text = selected.text.trim();
    
    if (formatBold) {
      formatBold.classList.toggle('active', text.startsWith('**') && text.endsWith('**') && text.length > 4);
    }
    
    if (formatItalic) {
      formatItalic.classList.toggle('active', 
        (text.startsWith('*') && text.endsWith('*') && !text.startsWith('**')) ||
        (text.startsWith('_') && text.endsWith('_') && !text.startsWith('__')));
    }
    
    if (formatUnderline) {
      formatUnderline.classList.toggle('active', text.includes('<u>') || (text.startsWith('_') && text.endsWith('_')));
    }
  } else {
    // Reset button states when no selection
    if (formatBold) formatBold.classList.remove('active');
    if (formatItalic) formatItalic.classList.remove('active');
    if (formatUnderline) formatUnderline.classList.remove('active');
  }
}

function showFormatBar() {
  const formatBar = document.getElementById('format-bar');
  if (formatBar) {
    formatBar.classList.remove('hidden');
    updatePreviewButtonVisibility();
  }
}

function updatePreviewButtonVisibility() {
  const togglePreviewBtn = document.getElementById('toggle-preview');
  if (!togglePreviewBtn) return;
  
  // Get current language mode
  const languageMode = getCurrentLanguageMode();
  
  // Show preview button only in markdown mode
  if (languageMode === 'markdown') {
    togglePreviewBtn.style.display = '';
  } else {
    togglePreviewBtn.style.display = 'none';
    // Also hide preview if visible but not in markdown mode
    if (previewVisible) {
      const previewContainer = document.getElementById('preview-container');
      const editorWrapper = document.getElementById('editor-wrapper');
      if (previewContainer) previewContainer.classList.add('hidden');
      if (editorWrapper) editorWrapper.classList.remove('split-view');
      togglePreviewBtn.classList.remove('active');
      previewVisible = false;
    }
  }
}

function handleLanguageModeChange(languageMode) {
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
  
  // Update preview button visibility
  updatePreviewButtonVisibility();
  
  // Update word count with preview settings immediately
  updateWordCount();
}

function handleSettingChange() {
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
  updateWordCount();
}

function setupColorPickerSync(colorPickerId, hexInputId) {
  const colorPicker = document.getElementById(colorPickerId);
  const hexInput = document.getElementById(hexInputId);
  
  if (colorPicker && hexInput) {
    // Sync color picker to hex input
    colorPicker.addEventListener('change', () => {
      hexInput.value = colorPicker.value;
      if (colorPickerId.startsWith('settings-')) {
        handleSettingChange();
      }
    });
    
    // Sync hex input to color picker
    hexInput.addEventListener('input', () => {
      const hexValue = hexInput.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(hexValue)) {
        colorPicker.value = hexValue;
        if (colorPickerId.startsWith('settings-')) {
          handleSettingChange();
        }
      }
    });
    
    // Also trigger on blur to validate
    hexInput.addEventListener('blur', () => {
      const hexValue = hexInput.value.trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(hexValue)) {
        // Reset to color picker value if invalid
        hexInput.value = colorPicker.value;
      }
    });
  }
}

function applyColorToEditor(type, color) {
  if (!editor) return;
  
  // Monaco Editor doesn't directly support custom font/background colors for the entire editor
  // We'll need to use CSS to override the editor's colors
  const editorContainer = document.getElementById('editor-container');
  if (editorContainer) {
    if (type === 'fontColor') {
      editorContainer.style.setProperty('--editor-font-color', color);
      // Use CSS to override Monaco's text color
      const style = document.createElement('style');
      style.id = 'editor-font-color-style';
      const existingStyle = document.getElementById('editor-font-color-style');
      if (existingStyle) existingStyle.remove();
      style.textContent = `
        #editor-container .monaco-editor .view-lines .view-line span {
          color: ${color} !important;
        }
        #editor-container .monaco-editor .view-lines {
          color: ${color} !important;
        }
        #editor-container .monaco-editor .current-line {
          color: ${color} !important;
        }
      `;
      document.head.appendChild(style);
    } else if (type === 'backgroundColor') {
      editorContainer.style.setProperty('--editor-bg-color', color);
      // Apply background color using Monaco's theme customization
      const style = document.createElement('style');
      style.id = 'editor-bg-color-style';
      const existingStyle = document.getElementById('editor-bg-color-style');
      if (existingStyle) existingStyle.remove();
      style.textContent = `
        #editor-container .monaco-editor .monaco-editor-background {
          background-color: ${color} !important;
        }
        #editor-container .monaco-editor {
          background-color: ${color} !important;
        }
        #editor-container .monaco-editor .margin {
          background-color: ${color} !important;
        }
        #editor-container .monaco-editor .current-line {
          background-color: ${color} !important;
        }
      `;
      document.head.appendChild(style);
    }
  }
}

async function syncFormatBarToSettings() {
  const formatFontColor = document.getElementById('format-fontColor');
  const formatBackgroundColor = document.getElementById('format-backgroundColor');
  const settingsFontColor = document.getElementById('settings-fontColor');
  const settingsBackgroundColor = document.getElementById('settings-backgroundColor');
  const settingsFontColorHex = document.getElementById('settings-fontColor-hex');
  const settingsBackgroundColorHex = document.getElementById('settings-backgroundColor-hex');
  
  // Get current color values from format bar
  const fontColorValue = formatFontColor ? formatFontColor.value : null;
  const backgroundColorValue = formatBackgroundColor ? formatBackgroundColor.value : null;
  
  if (!fontColorValue || !backgroundColorValue) {
    return; // Format bar colors not available
  }
  
  // Switch to custom theme when colors are changed
  const themeCustomRadio = document.getElementById('settings-theme-custom');
  const themeDarkRadio = document.getElementById('settings-theme-dark');
  const themeLightRadio = document.getElementById('settings-theme-light');
  const themeHcRadio = document.getElementById('settings-theme-hc');
  
  // Always switch to custom theme when colors are changed
  if (themeCustomRadio) {
    // Uncheck other theme radio buttons
    if (themeDarkRadio) themeDarkRadio.checked = false;
    if (themeLightRadio) themeLightRadio.checked = false;
    if (themeHcRadio) themeHcRadio.checked = false;
    
    // Check custom theme radio button
    themeCustomRadio.checked = true;
    updateColorInputsEnabled(true);
    
    // Update currentSettings theme immediately
    if (currentSettings) {
      currentSettings.theme = 'custom';
    }
  }
  
  // Update settings form inputs (if settings tab is open)
  if (settingsFontColor) {
    settingsFontColor.value = fontColorValue;
  }
  if (settingsFontColorHex) {
    settingsFontColorHex.value = fontColorValue;
  }
  if (settingsBackgroundColor) {
    settingsBackgroundColor.value = backgroundColorValue;
  }
  if (settingsBackgroundColorHex) {
    settingsBackgroundColorHex.value = backgroundColorValue;
  }
  
  // Load current settings from disk if not already loaded
  if (!currentSettings) {
    try {
      const savedSettings = await ipcRenderer.invoke('get-settings');
      currentSettings = JSON.parse(JSON.stringify(savedSettings));
    } catch (err) {
      // If that fails, create a minimal settings object
      currentSettings = {
        fontSize: 14,
        wordWrap: 'on',
        minimap: true,
        lineNumbers: true,
        autoSave: true,
        autoSaveInterval: 1000
      };
    }
  }
  
  // Update color values and theme in currentSettings
  currentSettings.fontColor = fontColorValue;
  currentSettings.backgroundColor = backgroundColorValue;
  currentSettings.theme = 'custom';
  
  // Save the updated settings to disk immediately
  try {
    const result = await ipcRenderer.invoke('save-settings', currentSettings);
    if (result.success) {
      console.log('Theme automatically switched to custom and saved');
      
      // Update originalSettings if settings tab is open
      if (settingsTabId && originalSettings) {
        originalSettings = JSON.parse(JSON.stringify(currentSettings));
        // Clear modified flag since we just saved
        const settingsTab = tabs.find(t => t.id === settingsTabId);
        if (settingsTab) {
          settingsTab.modified = false;
          renderTabs();
        }
      }
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function updateColorInputsEnabled(enabled) {
  const fontColor = document.getElementById('settings-fontColor');
  const fontColorHex = document.getElementById('settings-fontColor-hex');
  const backgroundColor = document.getElementById('settings-backgroundColor');
  const backgroundColorHex = document.getElementById('settings-backgroundColor-hex');
  
  // Update disabled state
  if (fontColor) {
    fontColor.disabled = !enabled;
    fontColor.style.opacity = enabled ? '1' : '0.5';
    fontColor.style.cursor = enabled ? 'pointer' : 'not-allowed';
  }
  if (fontColorHex) {
    fontColorHex.disabled = !enabled;
    fontColorHex.style.opacity = enabled ? '1' : '0.5';
    fontColorHex.style.cursor = enabled ? 'text' : 'not-allowed';
  }
  if (backgroundColor) {
    backgroundColor.disabled = !enabled;
    backgroundColor.style.opacity = enabled ? '1' : '0.5';
    backgroundColor.style.cursor = enabled ? 'pointer' : 'not-allowed';
  }
  if (backgroundColorHex) {
    backgroundColorHex.disabled = !enabled;
    backgroundColorHex.style.opacity = enabled ? '1' : '0.5';
    backgroundColorHex.style.cursor = enabled ? 'text' : 'not-allowed';
  }
  
  // Add/remove disabled class for additional styling
  const colorInputs = [fontColor, fontColorHex, backgroundColor, backgroundColorHex];
  colorInputs.forEach(input => {
    if (input) {
      if (enabled) {
        input.classList.remove('color-input-disabled');
      } else {
        input.classList.add('color-input-disabled');
      }
    }
  });
}

function hideFormatBar() {
  const formatBar = document.getElementById('format-bar');
  if (formatBar) {
    formatBar.classList.add('hidden');
  }
}

// Markdown preview functions
function togglePreviewPane() {
  previewVisible = !previewVisible;
  const editorWrapper = document.getElementById('editor-wrapper');
  const previewContainer = document.getElementById('preview-container');
  const togglePreviewBtn = document.getElementById('toggle-preview');
  
  if (previewVisible) {
    if (editorWrapper) editorWrapper.classList.add('split-view');
    if (previewContainer) previewContainer.classList.remove('hidden');
    if (togglePreviewBtn) togglePreviewBtn.classList.add('active');
    updatePreview();
  } else {
    if (editorWrapper) editorWrapper.classList.remove('split-view');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (togglePreviewBtn) togglePreviewBtn.classList.remove('active');
  }
}

function updatePreview() {
  if (!previewVisible || !editor) return;
  
  const previewContent = document.getElementById('preview-content');
  if (!previewContent) return;
  
  const markdown = editor.getValue();
  const html = renderMarkdown(markdown);
  previewContent.innerHTML = html;
  
  // Sync scroll position (optional - can be enhanced)
  syncPreviewScroll();
}

function renderMarkdown(markdown) {
  if (!markdown) return '';
  
  const lines = markdown.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeBlockContent = [];
  let inList = false;
  let listType = null;
  let listItems = [];
  
  function processInline(text) {
    // Don't process inline formatting inside code blocks
    if (inCodeBlock) return escapeHtml(text);
    
    let html = escapeHtml(text);
    
    // Code spans (must be before other formatting)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Underline (<u>text</u>)
    html = html.replace(/<u>([^<]+)<\/u>/g, '<u>$1</u>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    
    return html;
  }
  
  function closeList() {
    if (inList && listItems.length > 0) {
      const listTag = listType === 'ol' ? 'ol' : 'ul';
      result.push(`<${listTag}>`);
      listItems.forEach(item => {
        result.push(`  <li>${processInline(item)}</li>`);
      });
      result.push(`</${listTag}>`);
      listItems = [];
    }
    inList = false;
    listType = null;
  }
  
  function closeCodeBlock() {
    if (inCodeBlock && codeBlockContent.length > 0) {
      result.push('<pre><code>' + escapeHtml(codeBlockContent.join('\n')) + '</code></pre>');
      codeBlockContent = [];
    }
    inCodeBlock = false;
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Code blocks
    if (trimmed.startsWith('```')) {
      closeList();
      closeCodeBlock();
      inCodeBlock = !inCodeBlock;
      continue;
    }
    
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }
    
    // Headings
    if (trimmed.match(/^#{1,6}\s/)) {
      closeList();
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        result.push(`<h${level}>${processInline(text)}</h${level}>`);
      }
      continue;
    }
    
    // Horizontal rules
    if (trimmed.match(/^(---|\*\*\*)$/)) {
      closeList();
      result.push('<hr>');
      continue;
    }
    
    // Blockquotes
    if (trimmed.startsWith('>')) {
      closeList();
      const text = trimmed.substring(1).trim();
      result.push(`<blockquote>${processInline(text)}</blockquote>`);
      continue;
    }
    
    // Lists
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    
    if (numberedMatch || bulletMatch) {
      const itemText = numberedMatch ? numberedMatch[2] : bulletMatch[1];
      const currentListType = numberedMatch ? 'ol' : 'ul';
      
      if (!inList || listType !== currentListType) {
        closeList();
        inList = true;
        listType = currentListType;
      }
      
      listItems.push(itemText);
      continue;
    }
    
    // Regular paragraph or empty line
    closeList();
    
    if (trimmed) {
      result.push(`<p>${processInline(trimmed)}</p>`);
    } else {
      result.push('');
    }
  }
  
  // Close any open blocks
  closeList();
  closeCodeBlock();
  
  return result.join('\n');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function syncPreviewScroll() {
  // Optional: Sync scroll position between editor and preview
  // This can be enhanced for better UX
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
  // Store original settings for getCurrentLanguageMode
  originalSettings = settings;
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
    
    // Sync format bar colors to settings if they differ (user may have changed them)
    const formatFontColor = document.getElementById('format-fontColor');
    const formatBackgroundColor = document.getElementById('format-backgroundColor');
    if (formatFontColor && formatFontColor.value) {
      settings.fontColor = formatFontColor.value;
    }
    if (formatBackgroundColor && formatBackgroundColor.value) {
      settings.backgroundColor = formatBackgroundColor.value;
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
  const languageMode = settings.languageMode || 'plaintext';
  const plaintextRadio = document.getElementById('settings-languageMode-plaintext');
  const markdownRadio = document.getElementById('settings-languageMode-markdown');
  if (plaintextRadio) plaintextRadio.checked = (languageMode === 'plaintext');
  if (markdownRadio) markdownRadio.checked = (languageMode === 'markdown');
  
  // Load theme from radio buttons
  const theme = settings.theme || 'vs-dark';
  const themeDarkRadio = document.getElementById('settings-theme-dark');
  const themeLightRadio = document.getElementById('settings-theme-light');
  const themeHcRadio = document.getElementById('settings-theme-hc');
  const themeCustomRadio = document.getElementById('settings-theme-custom');
  if (themeDarkRadio) themeDarkRadio.checked = (theme === 'vs-dark');
  if (themeLightRadio) themeLightRadio.checked = (theme === 'vs');
  if (themeHcRadio) themeHcRadio.checked = (theme === 'hc-black');
  if (themeCustomRadio) themeCustomRadio.checked = (theme === 'custom');
  
  // Enable/disable color inputs based on theme
  updateColorInputsEnabled(theme === 'custom');
  
  // Load colors
  const fontColor = settings.fontColor || '#cccccc';
  const backgroundColor = settings.backgroundColor || '#1e1e1e';
  const fontColorEl = document.getElementById('settings-fontColor');
  const fontColorHexEl = document.getElementById('settings-fontColor-hex');
  const backgroundColorEl = document.getElementById('settings-backgroundColor');
  const backgroundColorHexEl = document.getElementById('settings-backgroundColor-hex');
  if (fontColorEl) fontColorEl.value = fontColor;
  if (fontColorHexEl) fontColorHexEl.value = fontColor;
  if (backgroundColorEl) backgroundColorEl.value = backgroundColor;
  if (backgroundColorHexEl) backgroundColorHexEl.value = backgroundColor;
  
  // Sync to format bar
  const formatFontColor = document.getElementById('format-fontColor');
  const formatFontColorHex = document.getElementById('format-fontColor-hex');
  const formatBackgroundColor = document.getElementById('format-backgroundColor');
  const formatBackgroundColorHex = document.getElementById('format-backgroundColor-hex');
  if (formatFontColor) formatFontColor.value = fontColor;
  if (formatFontColorHex) formatFontColorHex.value = fontColor;
  if (formatBackgroundColor) formatBackgroundColor.value = backgroundColor;
  if (formatBackgroundColorHex) formatBackgroundColorHex.value = backgroundColor;
  
  const fontSizeEl = document.getElementById('settings-fontSize');
  const wordWrapEl = document.getElementById('settings-wordWrap');
  const minimapEl = document.getElementById('settings-minimap');
  const lineNumbersEl = document.getElementById('settings-lineNumbers');
  const autoSaveEl = document.getElementById('settings-autoSave');
  const autoSaveIntervalEl = document.getElementById('settings-autoSaveInterval');
  if (fontSizeEl) fontSizeEl.value = settings.fontSize || 14;
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
  
  // Load format bar visibility options
  const showFormatBarBoldItalicEl = document.getElementById('settings-showFormatBarBoldItalic');
  const showFormatBarListsEl = document.getElementById('settings-showFormatBarLists');
  const showFormatBarColorsEl = document.getElementById('settings-showFormatBarColors');
  if (showFormatBarBoldItalicEl) showFormatBarBoldItalicEl.checked = viewOptions.showFormatBarBoldItalic !== undefined ? viewOptions.showFormatBarBoldItalic : true;
  if (showFormatBarListsEl) showFormatBarListsEl.checked = viewOptions.showFormatBarLists !== undefined ? viewOptions.showFormatBarLists : true;
  if (showFormatBarColorsEl) showFormatBarColorsEl.checked = viewOptions.showFormatBarColors !== undefined ? viewOptions.showFormatBarColors : true;
  
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
  
  // Setup language mode radio buttons
  const plaintextRadio = document.getElementById('settings-languageMode-plaintext');
  const markdownRadio = document.getElementById('settings-languageMode-markdown');
  if (plaintextRadio) {
    plaintextRadio.addEventListener('change', () => {
      if (plaintextRadio.checked) {
        handleLanguageModeChange('plaintext');
      }
    });
  }
  if (markdownRadio) {
    markdownRadio.addEventListener('change', () => {
      if (markdownRadio.checked) {
        handleLanguageModeChange('markdown');
      }
    });
  }
  
  // Setup theme radio buttons
  const themeDarkRadio = document.getElementById('settings-theme-dark');
  const themeLightRadio = document.getElementById('settings-theme-light');
  const themeHcRadio = document.getElementById('settings-theme-hc');
  const themeCustomRadio = document.getElementById('settings-theme-custom');
  
  // Default colors for each theme
  const themeDefaults = {
    'vs-dark': { fontColor: '#cccccc', backgroundColor: '#1e1e1e' },
    'vs': { fontColor: '#333333', backgroundColor: '#ffffff' },
    'hc-black': { fontColor: '#ffffff', backgroundColor: '#000000' },
    'custom': null // Custom theme uses current color values
  };
  
  const handleThemeChange = (themeValue) => {
    updateColorInputsEnabled(themeValue === 'custom');
    
    // If switching to a preset theme, update color values to theme defaults
    if (themeValue !== 'custom' && themeDefaults[themeValue]) {
      const defaults = themeDefaults[themeValue];
      const settingsFontColor = document.getElementById('settings-fontColor');
      const settingsFontColorHex = document.getElementById('settings-fontColor-hex');
      const settingsBackgroundColor = document.getElementById('settings-backgroundColor');
      const settingsBackgroundColorHex = document.getElementById('settings-backgroundColor-hex');
      const formatFontColor = document.getElementById('format-fontColor');
      const formatFontColorHex = document.getElementById('format-fontColor-hex');
      const formatBackgroundColor = document.getElementById('format-backgroundColor');
      const formatBackgroundColorHex = document.getElementById('format-backgroundColor-hex');
      
      // Update settings form inputs
      if (settingsFontColor) settingsFontColor.value = defaults.fontColor;
      if (settingsFontColorHex) settingsFontColorHex.value = defaults.fontColor;
      if (settingsBackgroundColor) settingsBackgroundColor.value = defaults.backgroundColor;
      if (settingsBackgroundColorHex) settingsBackgroundColorHex.value = defaults.backgroundColor;
      
      // Update format bar inputs
      if (formatFontColor) formatFontColor.value = defaults.fontColor;
      if (formatFontColorHex) formatFontColorHex.value = defaults.fontColor;
      if (formatBackgroundColor) formatBackgroundColor.value = defaults.backgroundColor;
      if (formatBackgroundColorHex) formatBackgroundColorHex.value = defaults.backgroundColor;
      
      // Apply colors immediately (even though they're disabled, we still want to show the values)
      if (editor) {
        // For preset themes, Monaco will handle the colors, but we can still update the display
      }
    }
    
    handleSettingChange();
  };
  
  if (themeDarkRadio) {
    themeDarkRadio.addEventListener('change', () => {
      if (themeDarkRadio.checked) {
        handleThemeChange('vs-dark');
      }
    });
  }
  if (themeLightRadio) {
    themeLightRadio.addEventListener('change', () => {
      if (themeLightRadio.checked) {
        handleThemeChange('vs');
      }
    });
  }
  if (themeHcRadio) {
    themeHcRadio.addEventListener('change', () => {
      if (themeHcRadio.checked) {
        handleThemeChange('hc-black');
      }
    });
  }
  if (themeCustomRadio) {
    themeCustomRadio.addEventListener('change', () => {
      if (themeCustomRadio.checked) {
        handleThemeChange('custom');
      }
    });
  }
  
  // Setup color picker sync (settings)
  setupColorPickerSync('settings-fontColor', 'settings-fontColor-hex');
  setupColorPickerSync('settings-backgroundColor', 'settings-backgroundColor-hex');
  
  // Apply settings immediately on change (live preview)
  const inputIds = [
    'settings-fontSize', 'settings-wordWrap',
    'settings-minimap', 'settings-lineNumbers', 'settings-autoSave',
    'settings-autoSaveInterval',
    'settings-fontColor', 'settings-backgroundColor',
    'settings-fontColor-hex', 'settings-backgroundColor-hex',
    'settings-showChineseWordCount', 'settings-showEnglishWordCount',
    'settings-showTotalWordCount', 'settings-showCharacterCount',
    'settings-showWordCountBreakdown', 'settings-showLineCount',
    'settings-showParagraphCount',
    'settings-showOutline', 'settings-showWordCount', 'settings-showStatusBar',
    'settings-showFormatBarBoldItalic', 'settings-showFormatBarLists', 'settings-showFormatBarColors'
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
          
          // Update preview button visibility if language mode changed
          updatePreviewButtonVisibility();
          
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
  // Get language mode from radio buttons
  const plaintextRadio = document.getElementById('settings-languageMode-plaintext');
  const markdownRadio = document.getElementById('settings-languageMode-markdown');
  let languageMode = 'plaintext';
  if (plaintextRadio && plaintextRadio.checked) languageMode = 'plaintext';
  if (markdownRadio && markdownRadio.checked) languageMode = 'markdown';
  
  // Get theme from radio buttons
  const themeDarkRadio = document.getElementById('settings-theme-dark');
  const themeLightRadio = document.getElementById('settings-theme-light');
  const themeHcRadio = document.getElementById('settings-theme-hc');
  const themeCustomRadio = document.getElementById('settings-theme-custom');
  let theme = 'vs-dark';
  if (themeDarkRadio && themeDarkRadio.checked) theme = 'vs-dark';
  if (themeLightRadio && themeLightRadio.checked) theme = 'vs';
  if (themeHcRadio && themeHcRadio.checked) theme = 'hc-black';
  if (themeCustomRadio && themeCustomRadio.checked) theme = 'custom';
  
  // Get colors
  const fontColorEl = document.getElementById('settings-fontColor');
  const backgroundColorEl = document.getElementById('settings-backgroundColor');
  const fontColor = fontColorEl ? fontColorEl.value : '#cccccc';
  const backgroundColor = backgroundColorEl ? backgroundColorEl.value : '#1e1e1e';
  
  return {
    languageMode: languageMode,
    fontSize: parseInt(document.getElementById('settings-fontSize').value),
    theme: theme,
    fontColor: fontColor,
    backgroundColor: backgroundColor,
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
      showStatusBar: document.getElementById('settings-showStatusBar').checked,
      showFormatBarBoldItalic: document.getElementById('settings-showFormatBarBoldItalic').checked,
      showFormatBarLists: document.getElementById('settings-showFormatBarLists').checked,
      showFormatBarColors: document.getElementById('settings-showFormatBarColors').checked
    }
  };
}

// Helper function to get current language mode
function getCurrentLanguageMode() {
  // Check current preview settings first
  if (currentSettings && currentSettings.languageMode) {
    return currentSettings.languageMode;
  }
  // Then check saved settings
  if (originalSettings && originalSettings.languageMode) {
    return originalSettings.languageMode;
  }
  // Default to plaintext
  return 'plaintext';
}

async function applySettings(settings) {
  // Store settings for getCurrentLanguageMode
  if (!currentSettings) {
    currentSettings = settings;
  }
  
  // Apply editor settings (only if editor exists)
  if (editor) {
    // Apply theme - only use Monaco themes for preset themes
    // For custom theme, we'll use custom colors instead
    if (settings.theme && settings.theme !== 'custom') {
      monaco.editor.setTheme(settings.theme);
    }
  }
  
  // Apply colors (only for custom theme, or if no theme specified)
  if (settings.theme === 'custom') {
    if (settings.fontColor) {
      applyColorToEditor('fontColor', settings.fontColor);
      // Sync to format bar
      const formatFontColor = document.getElementById('format-fontColor');
      const formatFontColorHex = document.getElementById('format-fontColor-hex');
      if (formatFontColor) formatFontColor.value = settings.fontColor;
      if (formatFontColorHex) formatFontColorHex.value = settings.fontColor;
    }
    if (settings.backgroundColor) {
      applyColorToEditor('backgroundColor', settings.backgroundColor);
      // Sync to format bar
      const formatBackgroundColor = document.getElementById('format-backgroundColor');
      const formatBackgroundColorHex = document.getElementById('format-backgroundColor-hex');
      if (formatBackgroundColor) formatBackgroundColor.value = settings.backgroundColor;
      if (formatBackgroundColorHex) formatBackgroundColorHex.value = settings.backgroundColor;
    }
  } else {
    // For preset themes, remove custom color styles
    const fontColorStyle = document.getElementById('editor-font-color-style');
    const bgColorStyle = document.getElementById('editor-bg-color-style');
    if (fontColorStyle) fontColorStyle.remove();
    if (bgColorStyle) bgColorStyle.remove();
  }
  
  // Apply editor settings (only if editor exists)
  if (editor) {
    // Apply language mode to all open tabs
    const languageMode = settings.languageMode || 'plaintext';
    tabs.forEach(tab => {
      if (tab.model && !tab.isSettings) {
        // Update the model's language
        monaco.editor.setModelLanguage(tab.model, languageMode);
      }
    });
    
    // Update preview if switching to/from markdown
    if (previewVisible && languageMode === 'markdown') {
      updatePreview();
    } else if (languageMode !== 'markdown') {
      // Hide preview if switching away from markdown
      if (previewVisible) {
        togglePreviewPane();
      }
    }
    
    // Update preview button visibility
    updatePreviewButtonVisibility();
    
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
    
    // Apply format bar visibility options
    const boldItalicGroup = document.getElementById('format-group-bold-italic-underline');
    const boldItalicSeparator = document.getElementById('format-separator-1');
    const listsGroup = document.getElementById('format-group-lists');
    const listsSeparator = document.getElementById('format-separator-2');
    const colorsGroup = document.getElementById('format-group-colors');
    const colorsSeparator = document.getElementById('format-separator-3');
    
    // Show/hide bold/italic/underline group
    if (viewOpts.showFormatBarBoldItalic !== undefined) {
      const show = viewOpts.showFormatBarBoldItalic;
      if (boldItalicGroup) {
        boldItalicGroup.style.display = show ? '' : 'none';
      }
      // Hide separator if group is hidden
      if (boldItalicSeparator) {
        boldItalicSeparator.style.display = show ? '' : 'none';
      }
    }
    
    // Show/hide lists group
    if (viewOpts.showFormatBarLists !== undefined) {
      const show = viewOpts.showFormatBarLists;
      if (listsGroup) {
        listsGroup.style.display = show ? '' : 'none';
      }
      // Hide separator if group is hidden
      if (listsSeparator) {
        listsSeparator.style.display = show ? '' : 'none';
      }
    }
    
    // Show/hide colors group
    if (viewOpts.showFormatBarColors !== undefined) {
      const show = viewOpts.showFormatBarColors;
      if (colorsGroup) {
        colorsGroup.style.display = show ? '' : 'none';
      }
      // Hide separator if group is hidden
      if (colorsSeparator) {
        colorsSeparator.style.display = show ? '' : 'none';
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

// escapeHtml is now defined in renderMarkdown function scope

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
  
  // Show format bar for new editor tab
  showFormatBar();
  
  // Initialize last saved content for this tab
  if (filePath) {
    lastSavedContent[tabId] = content;
  }
  
  // Create Monaco model for this tab (use language mode from settings)
  if (editor) {
    // Get language mode from current settings
    const languageMode = getCurrentLanguageMode();
    const model = monaco.editor.createModel(content, languageMode);
    editor.setModel(model);
    tab.model = model;
    // Update preview if visible and in markdown mode
    if (languageMode === 'markdown' && previewVisible) {
      updatePreview();
    }
  }
  
  // Update preview button visibility
  updatePreviewButtonVisibility();
  
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
    
    // Hide format bar for settings tab
    hideFormatBar();
    
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
  
  // Show format bar for editor tabs
  showFormatBar();
  
  if (editorContainer) editorContainer.style.display = '';
  if (settingsContainer) settingsContainer.classList.add('hidden');
  if (defaultView) defaultView.classList.add('hidden');
  
  // Switch to tab's model
  const languageMode = getCurrentLanguageMode();
  if (tab.model) {
    // Ensure model has correct language mode
    monaco.editor.setModelLanguage(tab.model, languageMode);
    editor.setModel(tab.model);
    // Update preview if visible and in markdown mode
    if (languageMode === 'markdown' && previewVisible) {
      updatePreview();
    }
  } else {
    const model = monaco.editor.createModel(tab.content, languageMode);
    editor.setModel(model);
    tab.model = model;
    // Update preview if visible and in markdown mode
    if (languageMode === 'markdown' && previewVisible) {
      updatePreview();
    }
  }
  
  // Update preview button visibility
  updatePreviewButtonVisibility();
  
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
  
  // Hide format bar
  hideFormatBar();
  
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
