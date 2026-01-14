const { ipcRenderer } = require('electron');

let currentSettings = {};

// Load settings when window opens
window.addEventListener('DOMContentLoaded', async () => {
  const settings = await ipcRenderer.invoke('get-settings');
  currentSettings = settings;
  loadSettingsIntoForm(settings);
  
  // Setup event listeners
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('cancelBtn').addEventListener('click', () => {
    window.close();
  });
});

function loadSettingsIntoForm(settings) {
  document.getElementById('fontSize').value = settings.fontSize || 14;
  document.getElementById('theme').value = settings.theme || 'vs-dark';
  document.getElementById('wordWrap').value = settings.wordWrap || 'on';
  document.getElementById('minimap').checked = settings.minimap !== false;
  document.getElementById('lineNumbers').checked = settings.lineNumbers !== false;
  document.getElementById('autoSave').checked = settings.autoSave !== false;
  document.getElementById('autoSaveInterval').value = (settings.autoSaveInterval || 1000) / 1000;
  
  // Word count display options
  const wordCountOptions = settings.wordCountOptions || {};
  document.getElementById('showChineseWordCount').checked = wordCountOptions.showChineseWordCount !== false;
  document.getElementById('showEnglishWordCount').checked = wordCountOptions.showEnglishWordCount !== false;
  document.getElementById('showTotalWordCount').checked = wordCountOptions.showTotalWordCount !== false;
  document.getElementById('showCharacterCount').checked = wordCountOptions.showCharacterCount !== false;
  document.getElementById('showWordCountBreakdown').checked = wordCountOptions.showWordCountBreakdown !== false;
  document.getElementById('showLineCount').checked = wordCountOptions.showLineCount || false;
  document.getElementById('showParagraphCount').checked = wordCountOptions.showParagraphCount || false;
}

async function saveSettings() {
  const settings = {
    fontSize: parseInt(document.getElementById('fontSize').value),
    theme: document.getElementById('theme').value,
    wordWrap: document.getElementById('wordWrap').value,
    minimap: document.getElementById('minimap').checked,
    lineNumbers: document.getElementById('lineNumbers').checked,
    autoSave: document.getElementById('autoSave').checked,
    autoSaveInterval: parseInt(document.getElementById('autoSaveInterval').value) * 1000,
    wordCountOptions: {
      showChineseWordCount: document.getElementById('showChineseWordCount').checked,
      showEnglishWordCount: document.getElementById('showEnglishWordCount').checked,
      showTotalWordCount: document.getElementById('showTotalWordCount').checked,
      showCharacterCount: document.getElementById('showCharacterCount').checked,
      showWordCountBreakdown: document.getElementById('showWordCountBreakdown').checked,
      showLineCount: document.getElementById('showLineCount').checked,
      showParagraphCount: document.getElementById('showParagraphCount').checked
    }
  };
  
  const result = await ipcRenderer.invoke('save-settings', settings);
  if (result.success) {
    window.close();
  } else {
    alert('Failed to save settings: ' + (result.error || 'Unknown error'));
  }
}
