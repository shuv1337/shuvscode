const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vscode = require('vscode');

const VIEW_ID = 'shuvscodeProjects.projects';
const PROJECTS_FILE = 'projects.json';
const WINDOWS_FILE = 'windows.json';
const RECENTS_KEY = 'shuvscode.projects.recentProjects';
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_STALE_MS = 20_000;

let windowRegistry; // exposed for deactivate cleanup

function activate(ctx) {
  const store = new ProjectStore(ctx);
  windowRegistry = new WindowRegistry(ctx, store);
  const provider = new ProjectsProvider(store, windowRegistry);
  const view = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true
  });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 28);

  async function refresh() {
    await provider.refresh();
    await updateStatus(status, store);
  }

  async function refreshIfLoaded() {
    if (provider.loaded) {
      await refresh();
    } else {
      await updateStatus(status, store);
    }
  }

  // Re-render when peer windows announce themselves or disappear.
  windowRegistry.onDidChange(() => {
    if (provider.loaded) {
      provider.refreshOpenWindows();
    }
  });

  ctx.subscriptions.push(
    view,
    status,
    windowRegistry,
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await windowRegistry.update();
      await refreshIfLoaded();
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('shuvscode.projects')) {
        refreshIfLoaded();
      }
    }),
    vscode.commands.registerCommand('shuvscodeProjects.refresh', refresh),
    vscode.commands.registerCommand('shuvscodeProjects.saveProject', async () => {
      await saveCurrentProject(store);
      await refresh();
    }),
    vscode.commands.registerCommand('shuvscodeProjects.addProjectToFavorites', async item => {
      await addProjectToFavorites(store, item && item.project);
      await refresh();
    }),
    vscode.commands.registerCommand('shuvscodeProjects.editProjects', async () => {
      await vscode.window.showTextDocument(await store.ensureProjectsFile());
    }),
    vscode.commands.registerCommand('shuvscodeProjects.revealProjectFile', async () => {
      const uri = await store.ensureProjectsFile();
      await vscode.commands.executeCommand('revealFileInOS', uri);
    }),
    vscode.commands.registerCommand('shuvscodeProjects.openProject', async item => {
      await chooseAndOpenProject(store, false, item);
    }),
    vscode.commands.registerCommand('shuvscodeProjects.openProjectInNewWindow', async item => {
      await chooseAndOpenProject(store, true, item);
    }),
    vscode.commands.registerCommand('shuvscodeProjects.removeProject', async item => {
      if (item && item.project && item.project.kind === 'favorite') {
        await store.removeFavorite(item.project);
        await refresh();
      }
    }),
    vscode.commands.registerCommand('shuvscodeProjects.switchToWindow', async item => {
      const project = item && item.project;
      if (!project) {
        return;
      }
      if (project.isCurrent) {
        // Already focused — just nudge the tree.
        await refresh();
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(project.rootPath),
        false
      );
    }),
    vscode.commands.registerCommand('shuvscodeProjects.openMultiplexerTerminal', async item => {
      const project = (item && item.project) || currentProject();
      await openMultiplexerTerminal(project);
    }),
    // Auto-open a project-scoped multiplexer terminal when a project loads,
    // if the user opted in via shuvscode.projects.autoOpenMultiplexer.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      maybeAutoOpenMultiplexerTerminal();
    })
  );
  // Also try once on activation in case the workspace folder was already set.
  maybeAutoOpenMultiplexerTerminal();

  windowRegistry.start();
  updateStatus(status, store);
}

function deactivate() {
  if (windowRegistry) {
    try {
      windowRegistry.removeSync();
    } catch {
      // best-effort cleanup on shutdown
    }
  }
}

class ProjectStore {
  constructor(ctx) {
    this.ctx = ctx;
  }

  config() {
    return vscode.workspace.getConfiguration('shuvscode.projects');
  }

  async projectsFile() {
    const configured = this.config().get('projectsLocation', '');
    const folder = configured ? expandPath(configured) : this.ctx.globalStorageUri.fsPath;
    await fs.mkdir(folder, { recursive: true });
    return vscode.Uri.file(path.join(folder, PROJECTS_FILE));
  }

  async ensureProjectsFile() {
    const uri = await this.projectsFile();
    try {
      await fs.access(uri.fsPath);
    } catch {
      await fs.writeFile(uri.fsPath, '[]\n', 'utf8');
    }
    return uri;
  }

  async readFavorites() {
    const uri = await this.ensureProjectsFile();
    try {
      const raw = await fs.readFile(uri.fsPath, 'utf8');
      const data = JSON.parse(raw || '[]');
      if (!Array.isArray(data)) {
        throw new Error('projects.json must contain an array.');
      }
      return data
        .filter(project => project && project.enabled !== false && project.name && project.rootPath)
        .map((project, index) => normalizeProject({
          ...project,
          rootPath: expandPath(project.rootPath),
          kind: 'favorite',
          order: index
        }));
    } catch (error) {
      const open = 'Open File';
      const choice = await vscode.window.showErrorMessage(
        `Could not read shuvscode projects.json: ${error.message}`,
        open
      );
      if (choice === open) {
        await vscode.window.showTextDocument(uri);
      }
      return [];
    }
  }

  async writeFavorites(projects) {
    const uri = await this.ensureProjectsFile();
    const serializable = projects.map(project => ({
      name: project.name,
      rootPath: project.rootPath,
      tags: project.tags || [],
      enabled: project.enabled !== false
    }));
    await fs.writeFile(uri.fsPath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
  }

  async addFavorite(project) {
    const favorites = await this.readFavorites();
    const rootPath = normalizeFsPath(project.rootPath);
    const existing = favorites.findIndex(item => normalizeFsPath(item.rootPath) === rootPath);
    const next = normalizeProject({ ...project, rootPath, kind: 'favorite', enabled: true });
    if (existing >= 0) {
      favorites.splice(existing, 1, next);
    } else {
      favorites.push(next);
    }
    await this.writeFavorites(favorites);
  }

  async removeFavorite(project) {
    const rootPath = normalizeFsPath(project.rootPath);
    const favorites = (await this.readFavorites())
      .filter(item => normalizeFsPath(item.rootPath) !== rootPath);
    await this.writeFavorites(favorites);
  }

  async allProjects() {
    const [favorites, detected] = await Promise.all([
      this.readFavorites(),
      this.detectGitProjects()
    ]);
    const seen = new Set(favorites.map(project => normalizeFsPath(project.rootPath)));
    return {
      favorites: await this.markInvalid(favorites),
      detected: await this.markInvalid(
        detected.filter(project => !seen.has(normalizeFsPath(project.rootPath)))
      )
    };
  }

  async detectGitProjects() {
    const config = this.config();
    const baseFolders = config.get('baseFolders', []);
    const ignoredFolders = new Set(config.get('ignoredFolders', []));
    const maxDepth = config.get('maxDepthRecursion', 4);
    const projects = [];
    const seen = new Set();

    for (const baseFolder of baseFolders) {
      const root = expandPath(baseFolder);
      try {
        const stat = await fs.stat(root);
        if (!stat.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      await scanForGit(root, 0);
    }

    async function scanForGit(folder, depth) {
      const key = normalizeFsPath(folder);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      try {
        if (await exists(path.join(folder, '.git'))) {
          projects.push(normalizeProject({
            name: path.basename(folder),
            rootPath: folder,
            kind: 'git',
            tags: []
          }));
          return;
        }

        if (depth >= maxDepth) {
          return;
        }

        const entries = await fs.readdir(folder, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || ignoredFolders.has(entry.name)) {
            continue;
          }
          await scanForGit(path.join(folder, entry.name), depth + 1);
        }
      } catch {
        // Ignore unreadable folders during discovery.
      }
    }

    return projects;
  }

  async markInvalid(projects) {
    if (!this.config().get('checkInvalidPathsBeforeListing', true)) {
      return projects;
    }

    return Promise.all(projects.map(async project => ({
      ...project,
      invalid: !(await exists(project.rootPath))
    })));
  }

  recents() {
    return this.ctx.globalState.get(RECENTS_KEY, []);
  }

  async remember(project) {
    const rootPath = normalizeFsPath(project.rootPath);
    const recents = [rootPath, ...this.recents().filter(item => item !== rootPath)].slice(0, 50);
    await this.ctx.globalState.update(RECENTS_KEY, recents);
  }
}

class ProjectsProvider {
  constructor(store, windowRegistry) {
    this.store = store;
    this.windowRegistry = windowRegistry;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.model = { favorites: [], detected: [] };
    this.loaded = false;
  }

  async refresh() {
    this.model = await this.store.allProjects();
    this.loaded = true;
    this.emitter.fire();
  }

  // Lightweight refresh used when only the peer-windows list changed.
  refreshOpenWindows() {
    this.emitter.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      await this.refreshIfEmpty();
      const openWindows = this.windowRegistry ? this.windowRegistry.list() : [];
      const groupList = this.store.config().get('groupList', true);
      const showOpenWindows = this.store.config().get('showOpenWindows', true);
      const root = [];
      if (showOpenWindows && openWindows.length > 0) {
        root.push(new GroupItem('Open Windows', openWindows.length, 'multiple-windows', 'openWindows'));
      }
      if (!groupList) {
        root.push(...this.projectItems([...this.model.favorites, ...this.model.detected]));
        return root;
      }
      root.push(
        new GroupItem('Favorites', this.model.favorites.length, 'star-full', 'favorites'),
        new GroupItem('Git Repositories', this.model.detected.length, 'repo', 'git')
      );
      return root;
    }

    if (element.group === 'openWindows') {
      const openWindows = this.windowRegistry ? this.windowRegistry.list() : [];
      if (openWindows.length === 0) {
        return [new EmptyItem('No other windows open')];
      }
      return openWindows.map(entry => new OpenWindowItem(entry));
    }

    if (element.group === 'favorites') {
      return this.projectItems(this.model.favorites);
    }

    if (element.group === 'git') {
      return this.projectItems(this.model.detected);
    }

    return [];
  }

  async refreshIfEmpty() {
    if (!this.loaded) {
      this.model = await this.store.allProjects();
      this.loaded = true;
    }
  }

  projectItems(projects) {
    const sorted = sortProjects(projects, this.store.config().get('sortList', 'Name'), this.store.recents());
    if (sorted.length === 0) {
      return [new EmptyItem()];
    }
    return sorted.map(project => new ProjectItem(project));
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(label, count, icon, group) {
    super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.group = group;
    this.contextValue = group === 'openWindows' ? 'openWindowsGroup' : 'group';
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor(label) {
    super(label || 'No projects found', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'empty';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class OpenWindowItem extends vscode.TreeItem {
  constructor(entry) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);
    this.project = entry;
    this.id = `openWindow:${entry.windowId}:${entry.rootPath}`;
    this.contextValue = entry.isCurrent ? 'openWindowCurrent' : 'openWindow';
    this.description = entry.isCurrent ? 'this window' : compactPath(entry.rootPath);
    this.tooltip = `${entry.name}\n${entry.rootPath}${entry.isCurrent ? '\n(this window)' : ''}`;
    this.resourceUri = vscode.Uri.file(entry.rootPath);
    this.iconPath = new vscode.ThemeIcon(
      entry.isCurrent ? 'circle-large-filled' : 'window',
      entry.isCurrent ? new vscode.ThemeColor('charts.orange') : undefined
    );
    this.command = {
      command: 'shuvscodeProjects.switchToWindow',
      title: 'Switch to Window',
      arguments: [this]
    };
  }
}

class ProjectItem extends vscode.TreeItem {
  constructor(project) {
    super(project.name, vscode.TreeItemCollapsibleState.None);
    this.project = project;
    this.id = `${project.kind}:${project.rootPath}`;
    this.contextValue = project.kind === 'favorite' ? 'projectFavorite' : 'project';
    const current = isCurrentProject(project);
    this.description = project.invalid ? 'missing' : current ? 'current' : project.tags.join(', ');
    const favoriteHint = project.kind === 'favorite' ? 'Saved favorite' : 'Right-click to add to Favorites';
    this.tooltip = `${project.name}\n${project.rootPath}\n${favoriteHint}`;
    this.resourceUri = vscode.Uri.file(project.rootPath);
    this.iconPath = new vscode.ThemeIcon(project.invalid ? 'warning' : (current ? 'folder-active' : 'folder'));
    this.command = {
      command: 'shuvscodeProjects.openProject',
      title: 'Open Project in This Window',
      arguments: [this]
    };
  }
}

async function saveCurrentProject(store) {
  const current = currentProject();
  if (!current) {
    vscode.window.showWarningMessage('Open a folder or workspace before adding it to Favorites.');
    return;
  }

  await addProjectToFavorites(store, current, { askName: true, title: 'Add Current Project to Favorites' });
}

async function addProjectToFavorites(store, project, options = {}) {
  if (!project) {
    vscode.window.showWarningMessage('Select a project before adding it to Favorites.');
    return;
  }

  if (project.invalid) {
    vscode.window.showWarningMessage(`Project path does not exist: ${project.rootPath}`);
    return;
  }

  let name = project.name;
  if (options.askName) {
    name = await vscode.window.showInputBox({
      title: options.title || 'Add Project to Favorites',
      prompt: 'Favorite name',
      value: project.name,
      validateInput: value => value.trim() ? undefined : 'Favorite name is required.'
    });

    if (!name) {
      return;
    }
  }

  await store.addFavorite({
    name: name.trim(),
    rootPath: project.rootPath,
    tags: project.tags || []
  });
  vscode.window.showInformationMessage(`Added "${name.trim()}" to Favorites.`);
}

async function chooseAndOpenProject(store, forceNewWindow, item) {
  const project = item && item.project ? item.project : await pickProject(store);
  if (!project) {
    return;
  }
  if (project.invalid) {
    vscode.window.showWarningMessage(`Project path does not exist: ${project.rootPath}`);
    return;
  }
  await store.remember(project);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.rootPath), forceNewWindow);
}

async function pickProject(store) {
  const model = await store.allProjects();
  const projects = sortProjects(
    [...model.favorites, ...model.detected],
    store.config().get('sortList', 'Name'),
    store.recents()
  );

  const picked = await vscode.window.showQuickPick(projects.map(project => ({
    label: project.name,
    description: project.invalid ? 'missing' : project.rootPath,
    detail: project.tags.length ? project.tags.join(', ') : project.kind,
    project
  })), {
    title: 'Open Project',
    placeHolder: 'Select a project'
  });

  return picked && picked.project;
}

async function updateStatus(status, store) {
  if (!store.config().get('showProjectNameInStatusBar', true)) {
    status.hide();
    return;
  }

  const current = currentProject();
  if (!current) {
    status.hide();
    return;
  }

  status.text = `$(folder-active) ${current.name}`;
  status.tooltip = current.rootPath;
  status.command = 'shuvscodeProjects.openProject';
  status.show();
}

function currentProject() {
  if (vscode.workspace.workspaceFile) {
    return {
      name: path.basename(vscode.workspace.workspaceFile.fsPath, '.code-workspace'),
      rootPath: vscode.workspace.workspaceFile.fsPath
    };
  }

  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) {
    return undefined;
  }

  return {
    name: folder.name || path.basename(folder.uri.fsPath),
    rootPath: folder.uri.fsPath
  };
}

function isCurrentProject(project) {
  const current = currentProject();
  return !!current && normalizeFsPath(current.rootPath) === normalizeFsPath(project.rootPath);
}

function normalizeProject(project) {
  return {
    name: project.name || path.basename(project.rootPath),
    rootPath: normalizeFsPath(project.rootPath),
    tags: Array.isArray(project.tags) ? project.tags.filter(Boolean) : [],
    enabled: project.enabled !== false,
    kind: project.kind || 'favorite',
    order: project.order || 0,
    invalid: !!project.invalid
  };
}

function sortProjects(projects, mode, recents) {
  const recentRank = new Map(recents.map((item, index) => [item, index]));
  return [...projects].sort((a, b) => {
    if (mode === 'Saved') {
      return a.order - b.order;
    }
    if (mode === 'Path') {
      return a.rootPath.localeCompare(b.rootPath);
    }
    if (mode === 'Recent') {
      return (recentRank.get(normalizeFsPath(a.rootPath)) ?? 9999) -
        (recentRank.get(normalizeFsPath(b.rootPath)) ?? 9999) ||
        a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
}

function expandPath(value) {
  if (!value) {
    return value;
  }
  return value
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replace(/^\$home(?=$|[\\/])/i, os.homedir());
}

function normalizeFsPath(value) {
  return path.resolve(expandPath(value));
}

async function exists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

function compactPath(value) {
  const home = os.homedir();
  if (value && value.startsWith(home)) {
    return `~${value.slice(home.length)}`;
  }
  return value || '';
}

// --- Multiplexer convenience ---------------------------------------------
//
// First-class support for terminal multiplexers (zellij, tmux, etc.). The
// goal is to make a per-project multiplexer session feel native: one command
// to open or attach, optionally auto-opened when the project loads.
//
// User-facing settings:
//   shuvscode.projects.multiplexerCommand  string  e.g. "zellij attach -c ${projectName}"
//   shuvscode.projects.multiplexerTerminalName  string  display name template
//   shuvscode.projects.autoOpenMultiplexer  bool   auto-run on project open
//
// Tokens substituted in the command and terminal name:
//   ${projectName} ${projectPath} ${projectSlug} ${cwd}

let _autoOpenMultiplexerDone = false;

function multiplexerSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function substituteMultiplexerTokens(template, project) {
  if (!template) {
    return template;
  }
  const tokens = {
    projectName: project && project.name ? project.name : '',
    projectPath: project && project.rootPath ? project.rootPath : '',
    projectSlug: multiplexerSlug(project && project.name),
    cwd: project && project.rootPath ? project.rootPath : ''
  };
  return template.replace(/\$\{(projectName|projectPath|projectSlug|cwd)\}/g, (_, key) => tokens[key] || '');
}

function multiplexerConfig() {
  return vscode.workspace.getConfiguration('shuvscode.projects');
}

async function openMultiplexerTerminal(project) {
  const target = project || currentProject();
  if (!target || !target.rootPath) {
    vscode.window.showWarningMessage('Open a project before launching the multiplexer terminal.');
    return;
  }
  const cfg = multiplexerConfig();
  const rawCommand = cfg.get('multiplexerCommand', '');
  const command = substituteMultiplexerTokens((rawCommand || '').trim(), target);
  if (!command) {
    vscode.window.showInformationMessage(
      'Set shuvscode.projects.multiplexerCommand (e.g. "zellij attach -c ${projectName}") to launch a multiplexer terminal.'
    );
    return;
  }
  const nameTemplate = cfg.get('multiplexerTerminalName', 'mux: ${projectName}');
  const name = substituteMultiplexerTokens(nameTemplate, target) || `mux: ${target.name || ''}`;

  // Reuse an existing terminal with the same name if it's already running.
  const existing = vscode.window.terminals.find(t => t.name === name);
  if (existing) {
    existing.show(true);
    return;
  }

  const terminal = vscode.window.createTerminal({
    name,
    cwd: target.rootPath
  });
  terminal.show(true);
  // Send the launch command; the multiplexer's own attach/create-or-attach
  // semantics handle the reattach case (e.g. `zellij attach -c <name>`).
  terminal.sendText(command, true);
}

async function maybeAutoOpenMultiplexerTerminal() {
  if (_autoOpenMultiplexerDone) {
    return;
  }
  const cfg = multiplexerConfig();
  if (!cfg.get('autoOpenMultiplexer', false)) {
    return;
  }
  if (!(cfg.get('multiplexerCommand', '') || '').trim()) {
    return;
  }
  const project = currentProject();
  if (!project) {
    return;
  }
  _autoOpenMultiplexerDone = true;
  // Small delay so xterm/pty are wired up before sendText.
  setTimeout(() => {
    openMultiplexerTerminal(project).catch(() => { /* best-effort */ });
  }, 800);
}

/**
 * Tracks which shuvscode windows are currently open by writing each window's
 * identity and root folder to a shared `windows.json` file in the extension's
 * global storage (shared across windows). A periodic heartbeat keeps the entry
 * fresh; entries older than HEARTBEAT_STALE_MS are pruned as dead.
 */
class WindowRegistry {
  constructor(ctx, store) {
    this.ctx = ctx;
    this.store = store;
    this.windowId = crypto.randomBytes(6).toString('hex');
    this.pid = process.pid;
    this.disposed = false;
    this.timer = undefined;
    this.watcher = undefined;
    this.cache = [];
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
  }

  start() {
    // Best-effort: write our entry immediately and refresh peer list.
    this.update().catch(() => {});
    this.refresh().catch(() => {});

    this.timer = setInterval(() => {
      if (this.disposed) {
        return;
      }
      this.update().catch(() => {});
      this.refresh().catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    // React quickly when other windows update the registry file.
    this.installFileWatcher().catch(() => {});
  }

  async installFileWatcher() {
    try {
      const folder = this.ctx.globalStorageUri.fsPath;
      await fs.mkdir(folder, { recursive: true });
      const filePath = path.join(folder, WINDOWS_FILE);
      // Ensure the file exists so fs.watch has a target on all platforms.
      try { await fs.access(filePath); } catch { await fs.writeFile(filePath, '[]\n', 'utf8'); }
      this.watcher = fsSync.watch(filePath, { persistent: false }, () => {
        if (this.disposed) {
          return;
        }
        this.refresh().catch(() => {});
      });
    } catch {
      // Watching is best-effort; the timer-based refresh is the safety net.
    }
  }

  list() {
    return this.cache;
  }

  filePath() {
    return path.join(this.ctx.globalStorageUri.fsPath, WINDOWS_FILE);
  }

  async readAll() {
    const filePath = this.filePath();
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async writeAll(entries) {
    const folder = this.ctx.globalStorageUri.fsPath;
    await fs.mkdir(folder, { recursive: true });
    const filePath = this.filePath();
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  async update() {
    if (this.disposed) {
      return;
    }
    const current = currentProject();
    const now = Date.now();
    const entries = (await this.readAll()).filter(entry => entry && entry.windowId !== this.windowId);
    if (current) {
      entries.push({
        windowId: this.windowId,
        pid: this.pid,
        name: current.name,
        rootPath: normalizeFsPath(current.rootPath),
        updatedAt: now
      });
    }
    // Drop stale peers while we're here.
    const fresh = entries.filter(entry => entry && entry.updatedAt && (now - entry.updatedAt) < HEARTBEAT_STALE_MS * 2);
    await this.writeAll(fresh);
  }

  async refresh() {
    if (this.disposed) {
      return;
    }
    const now = Date.now();
    const entries = (await this.readAll())
      .filter(entry => entry && entry.rootPath && entry.updatedAt && (now - entry.updatedAt) < HEARTBEAT_STALE_MS);
    // De-dupe by rootPath (a folder is owned by at most one window).
    const byRoot = new Map();
    for (const entry of entries) {
      const key = normalizeFsPath(entry.rootPath);
      const existing = byRoot.get(key);
      if (!existing || entry.updatedAt > existing.updatedAt) {
        byRoot.set(key, { ...entry, rootPath: key });
      }
    }
    const list = [...byRoot.values()]
      .map(entry => ({
        ...entry,
        isCurrent: entry.windowId === this.windowId
      }))
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) {
          return a.isCurrent ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    if (this.cacheChanged(list)) {
      this.cache = list;
      this.emitter.fire();
    }
  }

  cacheChanged(next) {
    if (next.length !== this.cache.length) {
      return true;
    }
    for (let i = 0; i < next.length; i++) {
      const a = next[i];
      const b = this.cache[i];
      if (!b || a.windowId !== b.windowId || a.rootPath !== b.rootPath || a.isCurrent !== b.isCurrent || a.name !== b.name) {
        return true;
      }
    }
    return false;
  }

  removeSync() {
    // Synchronous best-effort removal from `deactivate`.
    try {
      const filePath = this.filePath();
      const raw = fsSync.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw || '[]');
      if (!Array.isArray(data)) {
        return;
      }
      const remaining = data.filter(entry => entry && entry.windowId !== this.windowId);
      fsSync.writeFileSync(filePath, `${JSON.stringify(remaining, null, 2)}\n`, 'utf8');
    } catch {
      // ignore
    }
  }

  dispose() {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* ignore */ }
      this.watcher = undefined;
    }
    this.emitter.dispose();
    this.removeSync();
  }
}

module.exports = {
  activate,
  deactivate
};
