const assert = require('node:assert/strict');
const test = require('node:test');

const {
  STATE_KEYS,
  STATUS,
  decideLayout,
  isFreshProfile,
  readLayoutSnapshot
} = require('./layoutState');

function snapshot(values = {}, settings = {}) {
  return readLayoutSnapshot(key => values[key], settings);
}

test('fresh profile is eligible for layout without legacy sentinels', () => {
  const state = snapshot();
  assert.equal(isFreshProfile(state), true);
  assert.deepEqual(decideLayout(state), {
    shouldApply: true,
    status: STATUS.ok,
    reason: 'fresh profile eligible for layout'
  });
});

test('existing profile is adopted when legacy bootstrap sentinel exists', () => {
  const state = snapshot({ [STATE_KEYS.bootstrapped]: true });
  assert.equal(isFreshProfile(state), false);
  const decision = decideLayout(state);
  assert.equal(decision.shouldApply, true);
  assert.equal(decision.status, STATUS.ok);
  assert.equal(decision.reason, 'existing profile adopted by layout orchestrator');
});

test('unlocked profile skips automatic layout', () => {
  const state = snapshot({ [STATE_KEYS.unlocked]: true });
  assert.equal(decideLayout(state).status, STATUS.skippedUnlocked);
});

test('version bump is eligible when target exceeds applied version', () => {
  const state = snapshot({ [STATE_KEYS.appliedVersion]: 1 }, { targetVersion: 2 });
  const decision = decideLayout(state);
  assert.equal(decision.shouldApply, true);
  assert.equal(decision.status, STATUS.ok);
});

test('current numeric version is reasserted by default', () => {
  const state = snapshot({ [STATE_KEYS.appliedVersion]: 4 }, { targetVersion: 4 });
  const decision = decideLayout(state);
  assert.equal(decision.shouldApply, true);
  assert.equal(decision.status, STATUS.ok);
  assert.equal(decision.reason, 'layout version 4 reasserted on startup');
});

test('current numeric version is skipped when startup reassertion is disabled', () => {
  const state = snapshot(
    { [STATE_KEYS.appliedVersion]: 4 },
    { targetVersion: 4, reassertOnStartup: false }
  );
  assert.equal(decideLayout(state).status, STATUS.skippedCurrent);
});

test('reset force overrides disabled and unlocked state', () => {
  const state = snapshot(
    { [STATE_KEYS.unlocked]: true, [STATE_KEYS.bootstrapped]: true },
    { enabled: false }
  );
  const decision = decideLayout(state, { force: true });
  assert.equal(decision.shouldApply, true);
  assert.equal(decision.status, STATUS.ok);
});

test('string appliedVersion is rejected instead of compared', () => {
  const state = snapshot({ [STATE_KEYS.appliedVersion]: 'inherited' });
  const decision = decideLayout(state);
  assert.equal(decision.shouldApply, true);
  assert.equal(decision.status, STATUS.failed);
});
