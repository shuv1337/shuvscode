const vscode = require('vscode');
const {
  CURRENT_LAYOUT_VERSION,
  STATE_KEYS,
  STATUS,
  decideLayout,
  readLayoutSnapshot
} = require('./layoutState');

const EXTENSIONS = [];
const CTX_SCM_READY = 'shuvscode.layout.scmReady';
const SCM_READY_COMMAND = 'shuvscode.layout.whenScmReady';
let output;
let scmReadyState = { ready: false, reason: 'not-started' };
let scmReadyWaiters = [];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function resolveScmReadyWaiters(state) {
  const waiters = scmReadyWaiters;
  scmReadyWaiters = [];
  for (const resolve of waiters) {
    resolve(state);
  }
}

async function setScmReady(state) {
  scmReadyState = {
    ready: state.ready === true,
    reason: state.reason || (state.ready ? 'ready' : 'not-ready'),
    at: new Date().toISOString()
  };
  await vscode.commands.executeCommand('setContext', CTX_SCM_READY, scmReadyState.ready);
  if (scmReadyState.ready || state.final === true) {
    resolveScmReadyWaiters(scmReadyState);
  }
  return scmReadyState;
}

function whenScmReady({ timeoutMs = 4000 } = {}) {
  if (scmReadyState.ready) {
    return Promise.resolve(scmReadyState);
  }
  const safeTimeout = Math.max(0, Number(timeoutMs) || 0);
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      scmReadyWaiters = scmReadyWaiters.filter(waiter => waiter !== finish);
      resolve({
        ready: false,
        reason: scmReadyState.reason === 'not-started' ? 'timeout' : scmReadyState.reason,
        at: new Date().toISOString()
      });
    }, safeTimeout);
    const finish = state => {
      clearTimeout(timeout);
      resolve(state);
    };
    scmReadyWaiters.push(finish);
  });
}

function getScmReadyState() {
  return scmReadyState;
}

async function runLayoutCommand(command, snapshot, { fallback } = {}) {
  try {
    await vscode.commands.executeCommand(command);
    log(`editor grid: ran ${command}`, snapshot.debugLogging);
    return { command, ok: true };
  } catch (e) {
    const message = e && e.message || String(e);
    log(`editor grid: ${command} failed: ${message}`, snapshot.debugLogging);
    if (fallback) {
      return runLayoutCommand(fallback, snapshot);
    }
    return { command, ok: false, error: message };
  }
}

async function applyEditorGrid(snapshot) {
  const results = [];
  results.push(await runLayoutCommand('workbench.action.editorLayoutTwoRowsRight', snapshot));
  results.push(await runLayoutCommand('workbench.action.focusLastEditorGroup', snapshot));
  results.push(await runLayoutCommand('workbench.action.createTerminalEditorSameGroup', snapshot, {
    fallback: 'workbench.action.createTerminalEditor'
  }));
  results.push(await runLayoutCommand('workbench.action.lockEditorGroup', snapshot));
  results.push(await runLayoutCommand('workbench.action.focusFirstEditorGroup', snapshot));

  const failures = results.filter(result => !result.ok);
  if (failures.length > 0) {
    log(`editor grid: completed with ${failures.length} command failure(s)`, snapshot.debugLogging);
  } else {
    log('editor grid: applied terminal-in-editor cockpit layout', snapshot.debugLogging);
  }
  return { ok: failures.length === 0, results };
}

async function applyOpinionatedLayout(ctx, snapshot, { deferMs = 0 } = {}) {
  try {
    if (deferMs > 0) {
      log(`layout apply: waiting ${deferMs}ms for workbench restore`, snapshot.debugLogging);
      await delay(deferMs);
    }
    const editorGrid = await applyEditorGrid(snapshot);
    if (!editorGrid.ok) {
      const failedCommands = editorGrid.results
        .filter(result => !result.ok)
        .map(result => result.command)
        .join(', ');
      throw new Error(`editor grid command failure: ${failedCommands}`);
    }
    await vscode.commands.executeCommand('workbench.view.explorer');
    await vscode.commands.executeCommand('workbench.view.scm');
    await vscode.commands.executeCommand('workbench.view.explorer');
    await ctx.globalState.update(STATE_KEYS.appliedVersion, snapshot.targetVersion);
    await ctx.globalState.update(STATE_KEYS.canvasScmOpened, true);
    const state = await setScmReady({ ready: true, reason: 'source control opened by layout orchestrator' });
    log(`scm readiness: ready reason=${state.reason}`, snapshot.debugLogging);
    return { scm: state, editorGrid };
  } catch (e) {
    const reason = `source control open failed: ${e && e.message || e}`;
    await updateLastApply(ctx, STATUS.failed);
    const state = await setScmReady({ ready: false, reason, final: true });
    log(`scm readiness: failed reason=${reason}`, snapshot.debugLogging);
    return state;
  }
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
  if (result.decision.shouldApply) {
    await applyOpinionatedLayout(ctx, result.snapshot);
  }
  vscode.window.showInformationMessage('shuvscode: opinionated layout reset applied.');
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
    vscode.commands.registerCommand('shuvscode.layout.status', () => showLayoutStatus(ctx)),
    vscode.commands.registerCommand(SCM_READY_COMMAND, options => whenScmReady(options))
  );
  await setScmReady({ ready: false, reason: 'layout activation started' });

  const layoutResult = await evaluateLayout(ctx);

  if (!enabled) {
    await setScmReady({ ready: false, reason: 'bootstrap disabled', final: true });
    return { whenScmReady, getScmReadyState };
  }

  if (layoutResult.decision.shouldApply || !ctx.globalState.get(STATE_KEYS.canvasScmOpened)) {
    await applyOpinionatedLayout(ctx, layoutResult.snapshot, { deferMs: 2000 });
  }

  if (ctx.globalState.get(STATE_KEYS.bootstrapped)) {
    return { whenScmReady, getScmReadyState };
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

  return { whenScmReady, getScmReadyState };
}

function deactivate() {
  if (output) {
    output.dispose();
    output = undefined;
  }
}

module.exports = {
  activate,
  deactivate,
  whenScmReady,
  getScmReadyState
};
