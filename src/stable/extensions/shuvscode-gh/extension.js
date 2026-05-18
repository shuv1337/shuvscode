// shuvscode-gh: lightweight GitHub helper that fills in the missing
// `github:login` sign-in surface for the bundled GitHub Pull Requests
// extension, and surfaces the system `gh` CLI when available.
//
// This extension never holds tokens itself. Sign-in always goes through
// `vscode.authentication.getSession('github', ...)`. The shuvscode patch
// to the `github-authentication` extension is what actually consumes the
// `gh auth token` value on the auth-provider side; this extension just
// improves discoverability + the welcome UX.
//
// Why we register a real TreeDataProvider for `github:login`:
//   shuvscode strips VS Code's welcome-view contribution from the workbench,
//   so `viewsWelcome` entries are intentionally unavailable. Returning real
//   tree items keeps the GitHub login view useful instead of showing either a
//   raw "no data provider" fallback or a blank panel.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const CTX_DETECTED = 'shuvscode.gh.detected';
const CTX_AUTHENTICATED = 'shuvscode.gh.authenticated';
const CTX_DASH_DETECTED = 'shuvscode.gh.dash.detected';
const CTX_DASH_ENABLED = 'shuvscode.gh.dash.enabled';
const GH_DASH_INSTALL_COMMAND = 'gh extension install dlvhdr/gh-dash';

// Scope set requested by the GitHub Pull Requests extension by default.
// Matches vscode-pull-request-github's call to getSession().
const DEFAULT_SCOPES = ['read:user', 'user:email', 'repo', 'workflow'];

let output;
let loginProvider;
let ghDashState = {
  enabled: true,
  detected: false,
  descriptor: null,
  reason: 'not-started',
  ghPath: null
};

function log(line) {
  if (!output) {
    output = vscode.window.createOutputChannel('shuvscode GitHub');
  }
  output.appendLine(`[${new Date().toISOString()}] ${line}`);
}

function run(cmd, args, { timeoutMs = 4000 } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          finish({ ok: false, code: err.code ?? -1, stdout: String(stdout || ''), stderr: String(stderr || err.message) });
        } else {
          finish({ ok: true, code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        }
      });
    } catch (e) {
      finish({ ok: false, code: -1, stdout: '', stderr: String(e && e.message || e) });
      return;
    }
    child.on('error', e => finish({ ok: false, code: -1, stdout: '', stderr: String(e && e.message || e) }));
  });
}

function executableSearchPaths(extraPath = '') {
  const home = process.env.HOME || '';
  const paths = String(extraPath || process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const fallback of ['/usr/bin', '/usr/local/bin', home ? path.join(home, '.local/bin') : '']) {
    if (fallback && !paths.includes(fallback)) {
      paths.push(fallback);
    }
  }
  return paths;
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(command, extraPath = '') {
  if (!command) {
    return null;
  }
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return isExecutable(command) ? command : null;
  }
  for (const dir of executableSearchPaths(extraPath)) {
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getDashSettings() {
  const cfg = vscode.workspace.getConfiguration('shuvscode.gh.dash');
  return {
    enabled: cfg.get('enabled', true),
    executablePath: String(cfg.get('executablePath', '') || '').trim(),
    terminalName: String(cfg.get('terminalName', 'gh-dash') || 'gh-dash'),
    autoPromptInstall: cfg.get('autoPromptInstall', true)
  };
}

async function detectGhDash(settings = getDashSettings()) {
  const enabled = settings.enabled !== false;
  await vscode.commands.executeCommand('setContext', CTX_DASH_ENABLED, enabled);

  if (!enabled) {
    ghDashState = { enabled, detected: false, descriptor: null, reason: 'disabled by setting', ghPath: null };
    await vscode.commands.executeCommand('setContext', CTX_DASH_DETECTED, false);
    log('gh-dash detected=false reason=disabled by setting');
    return ghDashState;
  }

  if (settings.executablePath) {
    const configured = settings.executablePath;
    const result = await run(configured, ['--help']);
    if (result.ok) {
      ghDashState = {
        enabled,
        detected: true,
        descriptor: { command: configured, args: [], kind: 'configured-gh-dash' },
        reason: 'configured executable'
      };
      await vscode.commands.executeCommand('setContext', CTX_DASH_DETECTED, true);
      log(`gh-dash detected=true kind=configured-gh-dash command=${configured}`);
      return ghDashState;
    }
    ghDashState = { enabled, detected: false, descriptor: null, reason: `configured executable failed: ${result.stderr || result.stdout || result.code}`, ghPath: null };
    await vscode.commands.executeCommand('setContext', CTX_DASH_DETECTED, false);
    log(`gh-dash detected=false reason=${ghDashState.reason}`);
    return ghDashState;
  }

  const ghPath = resolveExecutable('gh');
  if (ghPath) {
    const result = await run(ghPath, ['dash', '--help']);
    if (result.ok) {
      ghDashState = {
        enabled,
        detected: true,
        descriptor: { command: ghPath, args: ['dash'], kind: 'gh-extension' },
        reason: 'gh dash extension'
      };
      await vscode.commands.executeCommand('setContext', CTX_DASH_DETECTED, true);
      log(`gh-dash detected=true kind=gh-extension command=${ghPath}`);
      return ghDashState;
    }
  }

  const ghDashPath = resolveExecutable('gh-dash');
  if (ghDashPath) {
    const result = await run(ghDashPath, ['--help']);
    if (result.ok) {
      ghDashState = {
        enabled,
        detected: true,
        descriptor: { command: ghDashPath, args: [], kind: 'standalone-gh-dash' },
        reason: 'standalone gh-dash'
      };
      await vscode.commands.executeCommand('setContext', CTX_DASH_DETECTED, true);
      log(`gh-dash detected=true kind=standalone-gh-dash command=${ghDashPath}`);
      return ghDashState;
    }
  }

  ghDashState = { enabled, detected: false, descriptor: null, reason: ghPath ? 'gh-dash unavailable' : 'gh unavailable' };
  ghDashState.ghPath = ghPath;
  await vscode.commands.executeCommand('setContext', CTX_DASH_DETECTED, false);
  log(`gh-dash detected=false reason=${ghDashState.reason}`);
  return ghDashState;
}

async function detectGh() {
  const ghPath = resolveExecutable('gh') || 'gh';
  const versionResult = await run(ghPath, ['--version']);
  const detected = versionResult.ok;
  await vscode.commands.executeCommand('setContext', CTX_DETECTED, detected);

  let authenticated = false;
  let user = null;
  if (detected) {
    // `gh auth status` exits 0 when authenticated to at least one host.
    const status = await run(ghPath, ['auth', 'status', '--hostname', 'github.com']);
    authenticated = status.ok;
    if (authenticated) {
      // Parse "Logged in to github.com as <user>" line; fall back to api call.
      const match = (status.stderr + '\n' + status.stdout).match(/Logged in to [^ ]+ (?:as|account) ([^\s(]+)/i);
      if (match) {
        user = match[1];
      } else {
        const api = await run(ghPath, ['api', 'user', '--jq', '.login'], { timeoutMs: 6000 });
        if (api.ok) {
          user = api.stdout.trim() || null;
        }
      }
    }
  }
  await vscode.commands.executeCommand('setContext', CTX_AUTHENTICATED, authenticated);

  const dash = await detectGhDash();
  const state = { detected, authenticated, user, dash };
  if (loginProvider) {
    loginProvider.setState(state);
  }
  log(`gh detected=${detected} authenticated=${authenticated} user=${user || '<none>'} command=${detected ? ghPath : '<none>'}`);
  return state;
}

async function signIn() {
  try {
    const session = await vscode.authentication.getSession('github', DEFAULT_SCOPES, { createIfNone: true });
    if (session) {
      log(`getSession returned account=${session.account?.label || '<unknown>'}`);
      vscode.window.setStatusBarMessage(`$(github) Signed in to GitHub as ${session.account?.label || 'GitHub'}`, 5000);
      // Nudge the PR extension to refresh now that we have a session.
      try {
        await vscode.commands.executeCommand('pr.signinAndRefreshList');
      } catch {
        // command may not be registered yet if the PR extension isn't activated; ignore.
      }
    }
  } catch (e) {
    if (e && (e.message === 'Cancelled' || /cancel/i.test(String(e.message)))) {
      return;
    }
    log(`signIn failed: ${e && e.message || e}`);
    vscode.window.showErrorMessage(`shuvscode GitHub sign-in failed: ${e && e.message || e}`);
  }
}

async function openTerminal() {
  const term = vscode.window.createTerminal({ name: 'gh auth login' });
  term.show(true);
  term.sendText('gh auth login', false);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildGhDashCommand(descriptor) {
  const args = [...descriptor.args];
  return [shellQuote(descriptor.command), ...args.map(shellQuote)].join(' ');
}

function findTerminal(name) {
  return vscode.window.terminals.find(term => term.name === name);
}

async function openGhDashInstall() {
  const settings = getDashSettings();
  const state = await detectGhDash(settings);
  if (state.detected) {
    vscode.window.showInformationMessage('gh-dash is already available.');
    return state;
  }
  if (!state.ghPath) {
    vscode.window.showWarningMessage('GitHub CLI is required before gh-dash can be installed. Install gh, then run gh auth login.');
    return state;
  }

  const choice = await vscode.window.showInformationMessage(
    `Install gh-dash with: ${GH_DASH_INSTALL_COMMAND}`,
    { modal: true },
    'Open Install Terminal'
  );
  if (choice !== 'Open Install Terminal') {
    log('gh-dash install: user declined install terminal');
    return state;
  }

  const term = vscode.window.createTerminal({ name: `${settings.terminalName} install` });
  term.show(true);
  term.sendText(GH_DASH_INSTALL_COMMAND, false);
  log(`gh-dash install: opened terminal with ${GH_DASH_INSTALL_COMMAND}`);
  return state;
}

async function ensureGhDashReady() {
  const ghState = await detectGh();
  if (!ghState.detected) {
    const choice = await vscode.window.showWarningMessage(
      'GitHub CLI is not installed or not visible to shuvscode. Install gh, then run gh auth login.',
      'Open Terminal'
    );
    if (choice === 'Open Terminal') {
      await openTerminal();
    }
    return null;
  }
  if (!ghState.authenticated) {
    const choice = await vscode.window.showWarningMessage(
      'GitHub CLI is installed but not signed in. Run gh auth login before opening gh-dash.',
      'Open gh auth login'
    );
    if (choice === 'Open gh auth login') {
      await openTerminal();
    }
    return null;
  }
  if (!ghState.dash.detected || !ghState.dash.descriptor) {
    const settings = getDashSettings();
    if (settings.autoPromptInstall === false) {
      vscode.window.showWarningMessage('gh-dash is not installed or not visible to shuvscode.');
      return null;
    }
    const choice = await vscode.window.showWarningMessage(
      'gh-dash is not installed or not visible to shuvscode.',
      'Install gh-dash'
    );
    if (choice === 'Install gh-dash') {
      await openGhDashInstall();
    }
    return null;
  }
  return { gh: ghState, settings: getDashSettings() };
}

async function openGhDash(view = 'dashboard') {
  const ready = await ensureGhDashReady();
  if (!ready) {
    return null;
  }

  const { gh, settings } = ready;
  const terminalName = settings.terminalName || 'gh-dash';
  let term = findTerminal(terminalName);
  const command = buildGhDashCommand(gh.dash.descriptor);

  if (term) {
    const choice = await vscode.window.showInformationMessage(
      `Reuse existing ${terminalName} terminal or restart it with ${command}?`,
      'Show Existing',
      'Restart'
    );
    if (choice === 'Restart') {
      term.dispose();
      term = undefined;
    } else {
      term.show(true);
      log(`gh-dash launch: reused existing terminal name=${terminalName} view=${view}`);
      return { reused: true, command, descriptor: gh.dash.descriptor, view };
    }
  }

  term = vscode.window.createTerminal({ name: terminalName });
  term.show(true);
  term.sendText(command, true);
  log(`gh-dash launch: started terminal name=${terminalName} view=${view} command=${command}`);
  return { reused: false, command, descriptor: gh.dash.descriptor, view };
}

async function openInBrowser() {
  const result = await run('gh', ['api', 'user', '--jq', '.html_url'], { timeoutMs: 6000 });
  if (result.ok && result.stdout.trim()) {
    await vscode.env.openExternal(vscode.Uri.parse(result.stdout.trim()));
  } else {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com'));
  }
}

class LoginItem extends vscode.TreeItem {
  constructor(label, description, command, icon = 'github') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    if (command) {
      this.command = {
        command,
        title: label
      };
    }
  }
}

class GitHubLoginProvider {
  constructor() {
    this.state = { loading: true, detected: false, authenticated: false, user: null };
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  setState(state) {
    this.state = { loading: false, ...state };
    this.emitter.fire();
  }

  getTreeItem(item) {
    return item;
  }

  getChildren() {
    if (this.state.loading) {
      return [
        new LoginItem('Checking GitHub CLI', 'Detecting gh on PATH', undefined, 'loading~spin'),
        new LoginItem('Sign in to GitHub', 'Use browser auth', 'shuvscode.gh.signIn', 'sign-in')
      ];
    }
    if (!this.state.detected) {
      return [
        new LoginItem('Sign in to GitHub', 'Use browser auth', 'shuvscode.gh.signIn', 'sign-in'),
        new LoginItem('Install or configure gh CLI', 'Run gh auth login in a terminal', 'shuvscode.gh.openTerminal', 'terminal')
      ];
    }
    if (!this.state.authenticated) {
      return [
        new LoginItem('Sign in with gh CLI', 'Run gh auth login', 'shuvscode.gh.openTerminal', 'terminal'),
        new LoginItem('Sign in with browser', 'Use GitHub browser auth', 'shuvscode.gh.signIn', 'sign-in')
      ];
    }
    return [
      new LoginItem('Use gh CLI account', this.state.user ? `Signed in as ${this.state.user}` : 'Signed in with gh CLI', 'shuvscode.gh.signIn', 'github'),
      new LoginItem('Refresh gh CLI detection', 'Check current gh auth state', 'shuvscode.gh.refreshDetection', 'refresh'),
      new LoginItem('Open GitHub profile', 'Open in browser', 'shuvscode.gh.openInBrowser', 'link-external')
    ];
  }
}

function registerLoginProvider(ctx, viewId) {
  try {
    loginProvider = new GitHubLoginProvider();
    const disposable = vscode.window.registerTreeDataProvider(viewId, loginProvider);
    ctx.subscriptions.push(disposable);
    log(`registered login TreeDataProvider for ${viewId}`);
  } catch (e) {
    log(`failed to register login TreeDataProvider for ${viewId}: ${e && e.message || e}`);
  }
}

// Moves the GitHub Pull Requests / Issues / Notifications views into the
// Source Control container the first time the extension activates with the
// `shuvscode.gh.colocateWithSourceControl` setting enabled. Persists a flag in
// globalState so we never re-run on subsequent activations — once the user has
// the views in SCM (or has dragged them somewhere else after the move), we
// leave the layout alone.
//
// Why this exists: shuvscode users typically run with
// `workbench.sideBar.experimental.splitWithSecondarySideBar` and keep Source
// Control in the right (auxiliary) sidebar. Pull Requests / Issues feel
// orphaned in the activity bar; colocating them with Source Control puts all
// the "what does my repo look like right now" UI in one place.
const COLOCATION_STATE_KEY = 'shuvscode.gh.colocatedWithSourceControl';
const COLOCATED_VIEW_IDS = ['pr:github', 'issues:github', 'notifications:github'];
const COLOCATION_DESTINATION_ID = 'workbench.view.scm';
const LAYOUT_EXTENSION_ID = 'shuvscode.shuvscode-bootstrap';

async function waitForScmReadiness({ timeoutMs = 4000 } = {}) {
  const extension = vscode.extensions.getExtension(LAYOUT_EXTENSION_ID);
  if (!extension) {
    return { ready: false, reason: 'layout extension unavailable' };
  }

  try {
    const api = extension.isActive ? extension.exports : await extension.activate();
    if (api && typeof api.whenScmReady === 'function') {
      return await api.whenScmReady({ timeoutMs });
    }
  } catch (e) {
    log(`colocateWithSourceControl: layout readiness API failed: ${e && e.message || e}`);
  }

  try {
    return await vscode.commands.executeCommand('shuvscode.layout.whenScmReady', { timeoutMs });
  } catch (e) {
    return { ready: false, reason: `layout readiness command unavailable: ${e && e.message || e}` };
  }
}

async function colocateWithSourceControlIfNeeded(ctx) {
  const cfg = vscode.workspace.getConfiguration('shuvscode.gh');
  if (!cfg.get('colocateWithSourceControl', true)) {
    log('colocateWithSourceControl: disabled by setting');
    return;
  }
  if (ctx.globalState.get(COLOCATION_STATE_KEY)) {
    log('colocateWithSourceControl: already colocated, skipping');
    return;
  }
  try {
    const readiness = await waitForScmReadiness({ timeoutMs: 4000 });
    if (readiness.ready) {
      log(`colocateWithSourceControl: scm ready (${readiness.reason})`);
    } else {
      log(`colocateWithSourceControl: scm readiness fallback (${readiness.reason || 'unknown'})`);
    }
    await vscode.commands.executeCommand('vscode.moveViews', {
      viewIds: COLOCATED_VIEW_IDS,
      destinationId: COLOCATION_DESTINATION_ID
    });
    await ctx.globalState.update(COLOCATION_STATE_KEY, true);
    log(`colocateWithSourceControl: moved ${COLOCATED_VIEW_IDS.join(', ')} into ${COLOCATION_DESTINATION_ID}`);
  } catch (e) {
    log(`colocateWithSourceControl: failed: ${e && e.message || e}`);
  }
}

function activate(ctx) {
  log('activating shuvscode-gh');

  registerLoginProvider(ctx, 'github:login');

  ctx.subscriptions.push(
    vscode.commands.registerCommand('shuvscode.gh.signIn', signIn),
    vscode.commands.registerCommand('shuvscode.gh.refreshDetection', async () => {
      const state = await detectGh();
      vscode.window.showInformationMessage(
        state.detected
          ? state.authenticated
            ? `gh CLI detected and signed in${state.user ? ` as ${state.user}` : ''}.`
            : 'gh CLI detected but not signed in. Run `gh auth login`.'
          : 'gh CLI is not installed or not on PATH.'
      );
    }),
    vscode.commands.registerCommand('shuvscode.gh.openTerminal', openTerminal),
    vscode.commands.registerCommand('shuvscode.gh.openInBrowser', openInBrowser),
    vscode.commands.registerCommand('shuvscode.gh.dash.open', () => openGhDash('dashboard')),
    vscode.commands.registerCommand('shuvscode.gh.dash.openPullRequests', () => openGhDash('pull-requests')),
    vscode.commands.registerCommand('shuvscode.gh.dash.openIssues', () => openGhDash('issues')),
    vscode.commands.registerCommand('shuvscode.gh.dash.openNotifications', () => openGhDash('notifications')),
    vscode.commands.registerCommand('shuvscode.gh.dash.install', openGhDashInstall),
    vscode.commands.registerCommand('shuvscode.gh.dash.refreshDetection', async () => {
      const state = await detectGhDash();
      vscode.window.showInformationMessage(
        state.detected && state.descriptor
          ? `gh-dash detected via ${state.descriptor.kind}.`
          : `gh-dash not detected: ${state.reason}.`
      );
      return state;
    }),
    vscode.commands.registerCommand('shuvscode.gh.resetColocation', async () => {
      await ctx.globalState.update(COLOCATION_STATE_KEY, undefined);
      vscode.window.showInformationMessage('shuvscode: GitHub view colocation flag reset. The next reload will re-run the one-shot move if the setting is enabled.');
    }),
  );

  // Initial detection — non-blocking.
  detectGh().catch(e => log(`detect failed: ${e && e.message || e}`));

  // Colocation — non-blocking, idempotent (guarded by globalState).
  colocateWithSourceControlIfNeeded(ctx).catch(e => log(`colocate failed: ${e && e.message || e}`));

  // Re-detect when a terminal closes (user may have just run `gh auth login`).
  ctx.subscriptions.push(
    vscode.window.onDidCloseTerminal(t => {
      if (t.name === 'gh auth login') {
        detectGh().catch(() => undefined);
      }
    })
  );
}

function deactivate() {
  if (output) {
    output.dispose();
    output = undefined;
  }
}

module.exports = { activate, deactivate };
