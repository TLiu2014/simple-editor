// Use Node's require (saved before Monaco loader)
const { ipcRenderer } = (window.nodeRequire || require)('electron');

let editor;
let autoSaveInterval;
let autoSaveEnabled = true; // Auto-save is enabled by default
let wordCountVisible = false;
let outlineVisible = false;
let lastSavedContent = '';
let outlineItems = [];

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
        updateWordCount();
        updateOutline();
      });

      // Initial updates
      updateWordCount();
      updateOutline();

      console.log('Monaco Editor initialized successfully');
      console.log('Editor instance:', editor);
      console.log('Editor container:', container);
      
      // Setup event listeners after editor is ready
      setupEventListeners();
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
function startAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
  }
  
  if (autoSaveEnabled) {
    autoSaveInterval = setInterval(() => {
      if (!editor) return;
      const content = editor.getValue();
      if (content !== lastSavedContent) {
        lastSavedContent = content;
        ipcRenderer.invoke('save-file', content).then(result => {
          if (result.success) {
            console.log('Auto-saved to:', result.path);
          }
        });
      }
    }, 2000);
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
  const button = document.getElementById('autoSaveToggle');
  
  if (autoSaveEnabled) {
    button.textContent = 'Auto Save: ON';
    button.classList.add('btn-active');
    startAutoSave();
  } else {
    button.textContent = 'Auto Save: OFF';
    button.classList.remove('btn-active');
    stopAutoSave();
  }
}

// Word count function (supports English and Chinese)
function countWords(text) {
  if (!text || text.trim().length === 0) {
    return { words: 0, characters: 0, chineseChars: 0 };
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

  return {
    words: totalWords,
    characters: totalCharacters,
    chineseChars: chineseChars,
    englishWords: englishWords.length
  };
}

function updateWordCount() {
  if (!editor) return;

  const content = editor.getValue();
  const counts = countWords(content);

  const wordCountElement = document.getElementById('wordCountText');
  if (wordCountElement) {
    wordCountElement.textContent = 
      `Words: ${counts.words} (Chinese: ${counts.chineseChars}, English: ${counts.englishWords}) | Characters: ${counts.characters}`;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Toggle word count visibility
  document.getElementById('wordCountToggle').addEventListener('click', () => {
    wordCountVisible = !wordCountVisible;
    const wordCountElement = document.getElementById('wordCount');
    if (wordCountVisible) {
      wordCountElement.classList.remove('hidden');
      updateWordCount();
    } else {
      wordCountElement.classList.add('hidden');
    }
  });

  // Toggle outline visibility
  document.getElementById('outlineToggle').addEventListener('click', () => {
    outlineVisible = !outlineVisible;
    const outlinePanel = document.getElementById('outline-panel');
    if (outlineVisible) {
      outlinePanel.classList.remove('hidden');
      updateOutline();
    } else {
      outlinePanel.classList.add('hidden');
    }
  });

  // Toggle auto-save
  document.getElementById('autoSaveToggle').addEventListener('click', () => {
    toggleAutoSave();
  });

  // Open file
  document.getElementById('openBtn').addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('open-file');
    if (result.success && result.content !== undefined) {
      editor.setValue(result.content);
      lastSavedContent = result.content;
      updateWordCount();
      updateOutline();
      await ipcRenderer.invoke('set-current-file-path', result.path);
    }
  });

  // Save file as
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const content = editor.getValue();
    const result = await ipcRenderer.invoke('save-file-as', content);
    if (result.success) {
      lastSavedContent = content;
      await ipcRenderer.invoke('set-current-file-path', result.path);
      console.log('File saved to:', result.path);
    }
  });
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

// Cleanup on window close
window.addEventListener('beforeunload', () => {
  stopAutoSave();
  if (editor) {
    editor.dispose();
  }
});
