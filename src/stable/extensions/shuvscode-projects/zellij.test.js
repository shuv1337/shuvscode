const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  isReservedHubTab,
  normalizeProject,
  parseTabs,
  projectTabName,
  shellQuote,
  slugifyName,
  substituteProjectTokens,
  ZellijManager
} = require('./zellij');

test('parseTabs normalizes zellij list-tabs JSON', () => {
  const tabs = parseTabs(JSON.stringify([
    { position: 0, name: 'hub', tab_id: 0, active: false },
    { position: 1, name: 'shuvscode', tab_id: 2, active: true }
  ]));

  assert.equal(tabs.length, 2);
  assert.equal(tabs[1].position, 1);
  assert.equal(tabs[1].tab_id, 2);
});

test('isReservedHubTab recognizes the default managed tab only by id zero', () => {
  assert.equal(isReservedHubTab({ tab_id: 0, name: 'Tab #1' }), true);
  assert.equal(isReservedHubTab({ tab_id: 0, name: 'hub' }), true);
  assert.equal(isReservedHubTab({ tab_id: 4, name: 'hub' }), false);
});

test('projectTabName avoids colliding with reserved hub names', () => {
  const project = { name: 'Hub', rootPath: '/tmp/hub' };
  assert.equal(projectTabName(project, '${projectSlug}'), 'hub-project');
});

test('slugifyName and token substitution are stable for project paths', () => {
  const project = { name: 'My Repo!', rootPath: '/tmp/my repo' };
  assert.equal(slugifyName(project.name), 'my-repo');
  assert.equal(
    substituteProjectTokens('${projectName}:${projectSlug}:${projectPath}:${cwd}', project),
    'My Repo!:my-repo:/tmp/my repo:/tmp/my repo'
  );
});

test('normalizeProject accepts path shorthand with explicit display name', () => {
  const project = normalizeProject('/tmp/my repo', { name: 'My Repo' });
  assert.equal(project.rootPath, path.resolve('/tmp/my repo'));
  assert.equal(project.name, 'My Repo');
});

test('ZellijManager merges direct config options with dynamic config', () => {
  const manager = new ZellijManager({
    storagePath: '/tmp/shuvscode-zellij-test',
    executablePath: '/usr/bin/zellij',
    sessionName: 'custom-session',
    getConfig: () => ({ tabNameTemplate: 'project:${projectSlug}' })
  });

  const config = manager.config();
  assert.equal(config.executablePath, '/usr/bin/zellij');
  assert.equal(config.sessionName, 'custom-session');
  assert.equal(config.tabNameTemplate, 'project:${projectSlug}');
});

test('shellQuote handles paths and quotes for terminal attach command text', () => {
  assert.equal(shellQuote("/tmp/it's here"), "'/tmp/it'\\''s here'");
});
