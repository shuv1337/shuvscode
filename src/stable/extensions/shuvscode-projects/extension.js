const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const vscode = require('vscode');

const VIEW_ID = 'shuvscodeProjects.projects';
const PROJECTS_FILE = 'projects.json';
const RECENTS_KEY = 'shuvscode.projects.recentProjects';

function activate(ctx) {
  const store = new ProjectStore(ctx);
  const provider = new ProjectsProvider(store);
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

  ctx.subscriptions.push(
    view,
    status,
    vscode.workspace.onDidChangeWorkspaceFolders(refreshIfLoaded),
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
    })
  );

  updateStatus(status, store);
}

function deactivate() {}

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
  constructor(store) {
    this.store = store;
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

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      await this.refreshIfEmpty();
      const groupList = this.store.config().get('groupList', true);
      if (!groupList) {
        return this.projectItems([...this.model.favorites, ...this.model.detected]);
      }
      return [
        new GroupItem('Favorites', this.model.favorites.length, 'star-full'),
        new GroupItem('Git Repositories', this.model.detected.length, 'repo')
      ];
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
  constructor(label, count, icon) {
    super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.group = label === 'Favorites' ? 'favorites' : 'git';
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor() {
    super('No projects found', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'empty';
    this.iconPath = new vscode.ThemeIcon('info');
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
    this.tooltip = `${project.name}\n${project.rootPath}`;
    this.resourceUri = vscode.Uri.file(project.rootPath);
    this.iconPath = new vscode.ThemeIcon(project.invalid ? 'warning' : (current ? 'folder-active' : 'folder'));
    this.command = {
      command: 'shuvscodeProjects.openProject',
      title: 'Open Project',
      arguments: [this]
    };
  }
}

async function saveCurrentProject(store) {
  const current = currentProject();
  if (!current) {
    vscode.window.showWarningMessage('Open a folder or workspace before saving a project.');
    return;
  }

  const name = await vscode.window.showInputBox({
    title: 'Save Project',
    prompt: 'Project name',
    value: current.name,
    validateInput: value => value.trim() ? undefined : 'Project name is required.'
  });

  if (!name) {
    return;
  }

  await store.addFavorite({
    name: name.trim(),
    rootPath: current.rootPath,
    tags: []
  });
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

module.exports = {
  activate,
  deactivate
};
