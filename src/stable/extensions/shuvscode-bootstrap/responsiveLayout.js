const LAYOUT_MODES = {
  terminalPrimary: 'terminal-primary',
  editorSidecar: 'editor-sidecar',
  reviewSidecar: 'review-sidecar'
};

function isHunkTerminalName(name) {
  return /^Hunk:/i.test(String(name || '').trim());
}

function chooseLayoutMode({ visibleTextEditorCount = 0, hunkTerminalCount = 0 } = {}) {
  if (visibleTextEditorCount > 0 && hunkTerminalCount > 0) {
    return LAYOUT_MODES.reviewSidecar;
  }
  if (visibleTextEditorCount > 0 || hunkTerminalCount > 0) {
    return LAYOUT_MODES.editorSidecar;
  }
  return LAYOUT_MODES.terminalPrimary;
}

function layoutForMode(mode) {
  if (mode === LAYOUT_MODES.reviewSidecar) {
    return {
      orientation: 0,
      groups: [
        { size: 0.66 },
        {
          size: 0.34,
          groups: [
            { size: 0.5 },
            { size: 0.5 }
          ]
        }
      ]
    };
  }

  if (mode === LAYOUT_MODES.editorSidecar) {
    return {
      orientation: 0,
      groups: [
        { size: 0.7 },
        { size: 0.3 }
      ]
    };
  }

  return {
    orientation: 0,
    groups: [
      { size: 1 }
    ]
  };
}

module.exports = {
  LAYOUT_MODES,
  chooseLayoutMode,
  isHunkTerminalName,
  layoutForMode
};
