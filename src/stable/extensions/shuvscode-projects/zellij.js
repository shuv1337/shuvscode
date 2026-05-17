const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const MANAGED_SESSION_FILE = 'zellij-managed-session.json';
const PROJECT_TABS_FILE = 'zellij-projects.json';
const OWNER = 'shuvscode-projects';
const DEFAULT_SESSION_NAME = 'shuvscode-managed';
const HUB_TAB_NAME = 'hub';
const DEFAULT_TIMEOUT_MS = 8000;

class ZellijError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ZellijError';
    this.code = code;
    Object.assign(this, details);
  }
}

function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function substituteProjectTokens(template, project) {
  if (!template) {
    return template;
  }
  const rootPath = project && project.rootPath ? project.rootPath : '';
  const tokens = {
    projectName: project && project.name ? project.name : '',
    projectPath: rootPath,
    projectSlug: slugifyName(project && project.name),
    cwd: rootPath,
    shell: process.env.SHELL || 'sh'
  };
  return template.replace(/\$\{(projectName|projectPath|projectSlug|cwd|shell)\}/g, (_, key) => tokens[key] || '');
}

function projectTabName(project, template = '${projectSlug}') {
  const raw = substituteProjectTokens(template || '${projectSlug}', project);
  const name = (raw || slugifyName(project && project.name)).trim() || 'project';
  if (/^(hub|tab #?1)$/i.test(name)) {
    return `${name}-project`;
  }
  return name;
}

function isReservedHubTab(tab) {
  return !!tab && Number(tab.tab_id) === 0 && (/^(hub|tab #?1)$/i.test(tab.name || ''));
}

function parseTabs(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch (error) {
    throw new ZellijError(`Could not parse zellij tab JSON: ${error.message}`, 'BAD_JSON', { cause: error, stdout: raw });
  }
  if (!Array.isArray(parsed)) {
    throw new ZellijError('zellij tab JSON was not an array', 'BAD_JSON', { stdout: raw });
  }
  return parsed
    .filter(tab => tab && typeof tab === 'object')
    .map(tab => ({
      ...tab,
      position: Number(tab.position),
      tab_id: Number(tab.tab_id)
    }));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function zellijShellCommand(executablePath, args) {
  return [executablePath, ...args].map(shellQuote).join(' ');
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

function normalizeConfig(config = {}) {
  return {
    enabled: !!config.enabled,
    executablePath: config.executablePath || 'zellij',
    sessionName: config.sessionName || DEFAULT_SESSION_NAME,
    tabNameTemplate: config.tabNameTemplate || '${projectSlug}',
    bootstrapCommand: config.bootstrapCommand || ''
  };
}

function normalizeProject(project, overrides = {}) {
  const input = typeof project === 'string' ? { rootPath: project } : { ...(project || {}) };
  const merged = { ...input, ...(overrides || {}) };
  if (!merged.rootPath) {
    throw new ZellijError('Project rootPath is required for Zellij project tabs.', 'BAD_PROJECT', { project });
  }
  const rootPath = path.resolve(merged.rootPath);
  return {
    ...merged,
    rootPath,
    name: merged.name || path.basename(rootPath) || rootPath
  };
}

class ZellijManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath;
    this.staticConfig = {
      enabled: options.enabled,
      executablePath: options.executablePath,
      sessionName: options.sessionName,
      tabNameTemplate: options.tabNameTemplate,
      bootstrapCommand: options.bootstrapCommand
    };
    this.getConfig = options.getConfig || (() => ({}));
    this.now = options.now || (() => Date.now());
  }

  config() {
    return normalizeConfig({ ...this.staticConfig, ...(this.getConfig() || {}) });
  }

  managedSessionPath() {
    return path.join(this.storagePath, MANAGED_SESSION_FILE);
  }

  projectTabsPath() {
    return path.join(this.storagePath, PROJECT_TABS_FILE);
  }

  async run(args, options = {}) {
    const cfg = this.config();
    const executable = cfg.executablePath;
    return new Promise((resolve, reject) => {
      const child = execFile(executable, args, {
        cwd: options.cwd,
        timeout: options.timeout || DEFAULT_TIMEOUT_MS,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          const code = error.code === 'ENOENT' ? 'MISSING_EXECUTABLE' : 'COMMAND_FAILED';
          reject(new ZellijError(
            `zellij command failed: ${executable} ${args.join(' ')}`,
            code,
            { cause: error, stdout, stderr, exitCode: error.code, executable, args }
          ));
          return;
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      });
      if (child && typeof child.unref === 'function' && options.unref) {
        child.unref();
      }
    });
  }

  async available() {
    try {
      const result = await this.run(['--version'], { timeout: 3000 });
      return { available: true, version: result.stdout.trim() };
    } catch (error) {
      return { available: false, error };
    }
  }

  async listSessions() {
    const result = await this.run(['list-sessions', '--short', '--no-formatting']);
    return result.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  async sessionExists(sessionName = this.config().sessionName) {
    return (await this.listSessions()).includes(sessionName);
  }

  async readManagedSession() {
    return readJson(this.managedSessionPath(), undefined);
  }

  async writeManagedSession(sessionName = this.config().sessionName) {
    const now = this.now();
    const existing = await this.readManagedSession();
    await writeJson(this.managedSessionPath(), {
      version: 1,
      sessionName,
      createdBy: OWNER,
      createdAt: existing && existing.sessionName === sessionName ? existing.createdAt : now,
      lastSeenAt: now
    });
  }

  async ensureManagedSession() {
    const cfg = this.config();
    const sessionName = cfg.sessionName;
    const exists = await this.sessionExists(sessionName);
    const metadata = await this.readManagedSession();
    const owned = metadata && metadata.sessionName === sessionName && metadata.createdBy === OWNER;

    if (exists && !owned) {
      throw new ZellijError(`Zellij session "${sessionName}" already exists but is not owned by shuvscode.`, 'UNOWNED_SESSION', { sessionName });
    }

    if (!exists) {
      await this.run(['attach', '--create-background', sessionName]);
    }

    await this.writeManagedSession(sessionName);
    await this.ensureHubTab(sessionName);
    return { sessionName, created: !exists };
  }

  async claimManagedSession(sessionName = this.config().sessionName) {
    if (!(await this.sessionExists(sessionName))) {
      throw new ZellijError(`Zellij session "${sessionName}" does not exist.`, 'SESSION_NOT_FOUND', { sessionName });
    }
    await this.writeManagedSession(sessionName);
    await this.ensureHubTab(sessionName);
  }

  async listTabs(sessionName = this.config().sessionName) {
    const result = await this.run(['--session', sessionName, 'action', 'list-tabs', '--json']);
    return parseTabs(result.stdout);
  }

  async ensureHubTab(sessionName = this.config().sessionName) {
    const tabs = await this.listTabs(sessionName);
    const first = tabs.find(tab => tab.tab_id === 0);
    if (first && first.name === 'Tab #1') {
      try {
        await this.run(['--session', sessionName, 'action', 'rename-tab-by-id', String(first.tab_id), HUB_TAB_NAME]);
      } catch {
        // Hub rename is cosmetic; keep the reserved default tab if rename fails.
      }
    }
  }

  async readProjectTabs() {
    return readJson(this.projectTabsPath(), { version: 1, sessionName: this.config().sessionName, projects: {} });
  }

  async writeProjectTabs(state) {
    await writeJson(this.projectTabsPath(), state);
  }

  async recordProjectTab(project, tab, tabName) {
    project = normalizeProject(project);
    const state = await this.readProjectTabs();
    const rootPath = path.resolve(project.rootPath);
    state.version = 1;
    state.sessionName = this.config().sessionName;
    state.projects = state.projects || {};
    state.projects[rootPath] = {
      name: project.name,
      slug: slugifyName(project.name),
      tabName,
      tabId: tab && Number.isFinite(tab.tab_id) ? tab.tab_id : undefined,
      tabPosition: tab && Number.isFinite(tab.position) ? tab.position : undefined,
      lastFocusedAt: this.now()
    };
    await this.writeProjectTabs(state);
  }

  async knownProjectRoots() {
    const state = await this.readProjectTabs();
    return new Set(Object.keys(state.projects || {}).map(root => path.resolve(root)));
  }

  findProjectTab(tabs, tabName) {
    return tabs.find(tab => tab.name === tabName && !isReservedHubTab(tab));
  }

  async ensureProjectTab(project, overrides = {}) {
    project = normalizeProject(project, overrides);
    const cfg = this.config();
    const sessionName = cfg.sessionName;
    const tabName = projectTabName(project, cfg.tabNameTemplate);
    let tabs = await this.listTabs(sessionName);
    let tab = this.findProjectTab(tabs, tabName);
    if (!tab) {
      const args = ['--session', sessionName, 'action', 'new-tab', '--cwd', project.rootPath, '--name', tabName];
      if (cfg.bootstrapCommand) {
        args.push('--', 'bash', '-lc', substituteProjectTokens(cfg.bootstrapCommand, project));
      }
      const result = await this.run(args, { cwd: project.rootPath });
      const createdId = Number((result.stdout || '').trim());
      tabs = await this.listTabs(sessionName);
      tab = Number.isFinite(createdId)
        ? tabs.find(item => item.tab_id === createdId)
        : this.findProjectTab(tabs, tabName);
    }
    if (!tab) {
      throw new ZellijError(`Could not create or locate Zellij tab "${tabName}".`, 'TAB_NOT_FOUND', { tabName, project });
    }
    await this.recordProjectTab(project, tab, tabName);
    return { tab, tabName };
  }

  async focusTab(tab, tabName) {
    const cfg = this.config();
    const sessionName = cfg.sessionName;
    if (tab && Number.isFinite(tab.tab_id)) {
      await this.run(['--session', sessionName, 'action', 'go-to-tab-by-id', String(tab.tab_id)]);
    } else {
      await this.run(['--session', sessionName, 'action', 'go-to-tab-name', tabName]);
    }
    const tabs = await this.listTabs(sessionName);
    const active = tabs.find(item => item.active);
    if (active && tab && Number.isFinite(tab.tab_id) && active.tab_id !== tab.tab_id) {
      throw new ZellijError(`Zellij focused "${active.name}" instead of "${tabName}".`, 'FOCUS_FAILED', { active, tab, tabName });
    }
    return active || tab;
  }

  attachCommand() {
    const cfg = this.config();
    return zellijShellCommand(cfg.executablePath, ['attach', '--create', cfg.sessionName]);
  }
}

module.exports = {
  DEFAULT_SESSION_NAME,
  HUB_TAB_NAME,
  ZellijError,
  ZellijManager,
  isReservedHubTab,
  normalizeProject,
  parseTabs,
  projectTabName,
  shellQuote,
  slugifyName,
  substituteProjectTokens
};
