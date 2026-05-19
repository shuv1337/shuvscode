const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LAYOUT_MODES,
  chooseLayoutMode,
  isHunkTerminalName,
  layoutForMode
} = require('./responsiveLayout');

test('terminal is primary when no editor or hunk data is visible', () => {
  assert.equal(chooseLayoutMode(), LAYOUT_MODES.terminalPrimary);
  assert.deepEqual(layoutForMode(LAYOUT_MODES.terminalPrimary), {
    orientation: 0,
    groups: [{ size: 1 }]
  });
});

test('visible file editor gets a small sidecar', () => {
  assert.equal(
    chooseLayoutMode({ visibleTextEditorCount: 1 }),
    LAYOUT_MODES.editorSidecar
  );
  assert.deepEqual(layoutForMode(LAYOUT_MODES.editorSidecar), {
    orientation: 0,
    groups: [{ size: 0.7 }, { size: 0.3 }]
  });
});

test('hunk terminal gets sidecar space without preallocating an extra row', () => {
  assert.equal(isHunkTerminalName('Hunk: storage.ts'), true);
  assert.equal(
    chooseLayoutMode({ hunkTerminalCount: 1 }),
    LAYOUT_MODES.editorSidecar
  );
});

test('file plus hunk terminal gets stacked review sidecar', () => {
  assert.equal(
    chooseLayoutMode({ visibleTextEditorCount: 1, hunkTerminalCount: 1 }),
    LAYOUT_MODES.reviewSidecar
  );
  assert.deepEqual(layoutForMode(LAYOUT_MODES.reviewSidecar), {
    orientation: 0,
    groups: [
      { size: 0.66 },
      { size: 0.34, groups: [{ size: 0.5 }, { size: 0.5 }] }
    ]
  });
});
