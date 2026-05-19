const CURRENT_LAYOUT_VERSION = 4;

const STATE_KEYS = {
  appliedVersion: 'shuvscode.layout.appliedVersion',
  unlocked: 'shuvscode.layout.unlocked',
  lastApplyStatus: 'shuvscode.layout.lastApplyStatus',
  lastApplyAt: 'shuvscode.layout.lastApplyAt',
  bootstrapped: 'shuvscode.bootstrapped',
  canvasScmOpened: 'shuvscode.canvas.scmAuxiliaryOpened'
};

const STATUS = {
  ok: 'ok',
  failed: 'failed',
  skippedDisabled: 'skipped:disabled',
  skippedUnlocked: 'skipped:unlocked',
  skippedCurrent: 'skipped:current'
};

function toLayoutVersion(value, fallback = CURRENT_LAYOUT_VERSION) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function readLayoutSnapshot(readState, settings = {}) {
  const appliedVersion = readState(STATE_KEYS.appliedVersion);
  const unlocked = readState(STATE_KEYS.unlocked) === true;
  const bootstrapped = readState(STATE_KEYS.bootstrapped);
  const canvasScmOpened = readState(STATE_KEYS.canvasScmOpened);

  return {
    appliedVersion,
    unlocked,
    lastApplyStatus: readState(STATE_KEYS.lastApplyStatus),
    lastApplyAt: readState(STATE_KEYS.lastApplyAt),
    bootstrapped,
    canvasScmOpened,
    enabled: settings.enabled !== false,
    reassertOnStartup: settings.reassertOnStartup !== false,
    debugLogging: settings.debugLogging !== false,
    targetVersion: toLayoutVersion(settings.targetVersion)
  };
}

function isFreshProfile(snapshot) {
  return snapshot.appliedVersion === undefined &&
    snapshot.unlocked !== true &&
    snapshot.bootstrapped === undefined &&
    snapshot.canvasScmOpened === undefined;
}

function decideLayout(snapshot, { force = false } = {}) {
  if (snapshot.enabled === false && !force) {
    return { shouldApply: false, status: STATUS.skippedDisabled, reason: 'layout disabled by setting' };
  }

  if (snapshot.unlocked === true && !force) {
    return { shouldApply: false, status: STATUS.skippedUnlocked, reason: 'profile unlocked by user' };
  }

  const appliedVersion = snapshot.appliedVersion;
  if (appliedVersion !== undefined && typeof appliedVersion !== 'number') {
    return { shouldApply: true, status: STATUS.failed, reason: 'layout appliedVersion is not numeric' };
  }

  if (force) {
    return { shouldApply: true, status: STATUS.ok, reason: 'layout reset requested' };
  }

  if (isFreshProfile(snapshot)) {
    return { shouldApply: true, status: STATUS.ok, reason: 'fresh profile eligible for layout' };
  }

  if (appliedVersion === undefined) {
    return { shouldApply: true, status: STATUS.ok, reason: 'existing profile adopted by layout orchestrator' };
  }

  if (snapshot.targetVersion > appliedVersion) {
    return { shouldApply: true, status: STATUS.ok, reason: `layout version ${snapshot.targetVersion} supersedes ${appliedVersion}` };
  }

  if (snapshot.reassertOnStartup === true) {
    return { shouldApply: true, status: STATUS.ok, reason: `layout version ${appliedVersion} reasserted on startup` };
  }

  return { shouldApply: false, status: STATUS.skippedCurrent, reason: `layout version ${appliedVersion} is current` };
}

module.exports = {
  CURRENT_LAYOUT_VERSION,
  STATE_KEYS,
  STATUS,
  decideLayout,
  isFreshProfile,
  readLayoutSnapshot,
  toLayoutVersion
};
