const vscode = require('vscode');
const {
  CURRENT_LAYOUT_VERSION,
  STATE_KEYS,
  decideLayout,
  readLayoutSnapshot
} = require('./layoutState');

const EXTENSIONS = [];
let output;

function getOutput() {
  if (!output) {
    output = vscode.window.createOutputChannel('shuvscode Layout');
  }
  return output;
}

function log(line, debugLogging = true) {
  if (!debugLogging) {
    return;
  }
  getOutput().appendLine(`[${new Date().toISOString()}] ${line}`);
}

function getLayoutSettings() {
  const cfg = vscode.workspace.getConfiguration('shuvscode.layout');
  return {
    enabled: cfg.get('enabled', true),
    targetVersion: cfg.get('targetVersion', CURRENT_LAYOUT_VERSION),
    reassertOnStartup: cfg.get('reassertOnStartup', true),
    debugLogging: cfg.get('debugLogging', true)
  };
}

async function updateLastApply(ctx, status) {
  await ctx.globalState.update(STATE_KEYS.lastApplyStatus, status);
  await ctx.globalState.update(STATE_KEYS.lastApplyAt, new Date().toISOString());
}

function snapshotFor(ctx) {
  const settings = getLayoutSettings();
  return readLayoutSnapshot(key => ctx.globalState.get(key), settings);
}

async function evaluateLayout(ctx, { force = false } = {}) {
  const snapshot = snapshotFor(ctx);
  const decision = decideLayout(snapshot, { force });
  await updateLastApply(ctx, decision.status);
  log(`layout decision: status=${decision.status} shouldApply=${decision.shouldApply} reason=${decision.reason}`, snapshot.debugLogging);
  if (
    decision.status === 'skipped:existing-profile' &&
    snapshot.lastApplyStatus !== 'skipped:existing-profile'
  ) {
    vscode.window.showInformationMessage('shuvscode: existing profile layout preserved. Run "shuvscode: Reset Opinionated Layout" to opt in.');
  }
  if (decision.status === 'failed') {
    vscode.window.showWarningMessage(`shuvscode layout decision failed: ${decision.reason}`);
  }
  return { snapshot, decision };
}

async function resetLayout(ctx) {
  await ctx.globalState.update(STATE_KEYS.unlocked, false);
  await ctx.globalState.update(STATE_KEYS.appliedVersion, 0);
  const result = await evaluateLayout(ctx, { force: true });
  vscode.window.showInformationMessage('shuvscode: opinionated layout reset requested. The layout will be applied by the next layout orchestration pass.');
  return result;
}

async function unlockLayout(ctx) {
  await ctx.globalState.update(STATE_KEYS.unlocked, true);
  await updateLastApply(ctx, 'skipped:unlocked');
  log('layout unlocked: automatic opinionated layout reassertion is disabled');
  vscode.window.showInformationMessage('shuvscode: opinionated layout unlocked for this profile.');
}

async function lockLayout(ctx) {
  await ctx.globalState.update(STATE_KEYS.unlocked, false);
  const result = await evaluateLayout(ctx);
  vscode.window.showInformationMessage('shuvscode: opinionated layout lock restored for this profile.');
  return result;
}

async function showLayoutStatus(ctx) {
  const snapshot = snapshotFor(ctx);
  const decision = decideLayout(snapshot);
  const applied = typeof snapshot.appliedVersion === 'number'
    ? String(snapshot.appliedVersion)
    : '<not applied>';
  const message = [
    `target=${snapshot.targetVersion}`,
    `applied=${applied}`,
    `unlocked=${snapshot.unlocked}`,
    `enabled=${snapshot.enabled}`,
    `last=${snapshot.lastApplyStatus || '<none>'}`,
    `decision=${decision.status}`
  ].join(' ');
  log(`layout status: ${message}`, snapshot.debugLogging);
  vscode.window.showInformationMessage(`shuvscode layout: ${message}`);
  return { snapshot, decision };
}

async function activate(ctx) {
  const enabled = vscode.workspace
    .getConfiguration('shuvscode.bootstrap')
    .get('enabled', true);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('shuvscode.layout.reset', () => resetLayout(ctx)),
    vscode.commands.registerCommand('shuvscode.layout.unlock', () => unlockLayout(ctx)),
    vscode.commands.registerCommand('shuvscode.layout.lock', () => lockLayout(ctx)),
    vscode.commands.registerCommand('shuvscode.layout.status', () => showLayoutStatus(ctx))
  );

  await evaluateLayout(ctx);

  if (!enabled) {
    return;
  }

  if (!ctx.globalState.get(STATE_KEYS.canvasScmOpened)) {
    try {
      await vscode.commands.executeCommand('workbench.view.scm');
      await ctx.globalState.update(STATE_KEYS.canvasScmOpened, true);
    } catch {
      // Non-fatal: keep bootstrap extension install behavior independent.
    }
  }

  if (ctx.globalState.get(STATE_KEYS.bootstrapped)) {
    return;
  }

  const results = await Promise.allSettled(
    EXTENSIONS
      .filter(id => !vscode.extensions.getExtension(id))
      .map(id =>
        vscode.commands.executeCommand(
          'workbench.extensions.installExtension',
          id
        )
      )
  );

  const anyFailure = results.some(r => r.status === 'rejected');

  if (!anyFailure) {
    await ctx.globalState.update(STATE_KEYS.bootstrapped, true);
  }
}

function deactivate() {
  if (output) {
    output.dispose();
    output = undefined;
  }
}

module.exports = {
  activate,
  deactivate
};
