// shuvscode-gh: lightweight GitHub helper that fills in the missing
// `github:login` empty states for the bundled GitHub Pull Requests
// extension, and surfaces the system `gh` CLI when available.
//
// This extension never holds tokens itself. Sign-in always goes through
// `vscode.authentication.getSession('github', ...)`. The shuvscode patch
// to the `github-authentication` extension is what actually consumes the
// `gh auth token` value on the auth-provider side; this extension just
// improves discoverability + the welcome UX.

const { execFile } = require('child_process');
const vscode = require('vscode');

const CTX_DETECTED = 'shuvscode.gh.detected';
const CTX_AUTHENTICATED = 'shuvscode.gh.authenticated';

// Scope set requested by the GitHub Pull Requests extension by default.
// Matches vscode-pull-request-github's call to getSession().
const DEFAULT_SCOPES = ['read:user', 'user:email', 'repo', 'workflow'];

let output;

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

async function detectGh() {
  const versionResult = await run('gh', ['--version']);
  const detected = versionResult.ok;
  await vscode.commands.executeCommand('setContext', CTX_DETECTED, detected);

  let authenticated = false;
  let user = null;
  if (detected) {
    // `gh auth status` exits 0 when authenticated to at least one host.
    const status = await run('gh', ['auth', 'status', '--hostname', 'github.com']);
    authenticated = status.ok;
    if (authenticated) {
      // Parse "Logged in to github.com as <user>" line; fall back to api call.
      const match = (status.stderr + '\n' + status.stdout).match(/Logged in to [^ ]+ (?:as|account) ([^\s(]+)/i);
      if (match) {
        user = match[1];
      } else {
        const api = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 6000 });
        if (api.ok) {
          user = api.stdout.trim() || null;
        }
      }
    }
  }
  await vscode.commands.executeCommand('setContext', CTX_AUTHENTICATED, authenticated);

  log(`gh detected=${detected} authenticated=${authenticated} user=${user || '<none>'}`);
  return { detected, authenticated, user };
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

async function openInBrowser() {
  const result = await run('gh', ['api', 'user', '--jq', '.html_url'], { timeoutMs: 6000 });
  if (result.ok && result.stdout.trim()) {
    await vscode.env.openExternal(vscode.Uri.parse(result.stdout.trim()));
  } else {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com'));
  }
}

function activate(ctx) {
  log('activating shuvscode-gh');

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
  );

  // Initial detection — non-blocking.
  detectGh().catch(e => log(`detect failed: ${e && e.message || e}`));

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
