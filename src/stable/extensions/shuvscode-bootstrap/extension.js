const vscode = require('vscode');

const FLAG = 'shuvscode.bootstrapped';
const CANVAS_SCM_FLAG = 'shuvscode.canvas.scmAuxiliaryOpened';

const EXTENSIONS = [];

async function activate(ctx) {
  const enabled = vscode.workspace
    .getConfiguration('shuvscode.bootstrap')
    .get('enabled', true);

  if (!enabled) {
    return;
  }

  if (!ctx.globalState.get(CANVAS_SCM_FLAG)) {
    try {
      await vscode.commands.executeCommand('workbench.view.scm');
      await ctx.globalState.update(CANVAS_SCM_FLAG, true);
    } catch {
      // Non-fatal: keep bootstrap extension install behavior independent.
    }
  }

  if (ctx.globalState.get(FLAG)) {
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
    await ctx.globalState.update(FLAG, true);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
