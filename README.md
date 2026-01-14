# Simple Editor

A simple text editor built with Electron and Monaco Editor, designed for desktop use (primarily macOS, with Windows support).

## Features

- **Monaco Editor**: Uses default settings of Monaco Editor v1
- **Word Count**: Supports word counting for both English and Chinese text, with a toggleable view
- **Auto Save**: Automatically saves content to a local file every 2 seconds

## Installation

1. Install dependencies:
```bash
npm install
```

## Running

Start the application:
```bash
npm start
```

## Usage

- **Open**: Click the "Open" button to open a text file
- **Save As**: Click the "Save As" button to save the current content to a new file
- **Toggle Word Count**: Click the "Toggle Word Count" button to show/hide word count statistics
- **Auto Save**: Content is automatically saved every 2 seconds to a local file

## Word Count

The word count feature:
- Counts Chinese characters (CJK unified ideographs)
- Counts English words (separated by whitespace)
- Shows total word count, character count, and breakdown by language
- Can be toggled on/off via the toolbar button
