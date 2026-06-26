export async function createSubagentFsm({ isApply = false, run, logger } = {}) {
  let createMachine;
  let createActor;
  try {
    const xstate = await import('xstate');
    createMachine = xstate.createMachine;
    createActor = xstate.createActor;
  } catch {
    createMachine = null;
  }

  const initial = isApply ? 'research' : 'fill';

  if (!createMachine) {
    let value = initial;
    const transitions = {
      research: { RESEARCH_DONE: 'fill', SKIP_RESEARCH: 'fill', FAIL: 'verify' },
      fill: { NEED_MORE_FILL: 'fill', REVIEW: 'review', SUBMIT_READY: 'submit', FINISH: 'verify', FAIL: 'verify' },
      review: { NEED_MORE_FILL: 'fill', SUBMIT_READY: 'submit', VERIFIED: 'verify', FAIL: 'verify' },
      submit: { SUBMITTED: 'verify', NEED_MORE_FILL: 'fill', FAIL: 'verify' },
      verify: {}
    };
    return {
      get state() { return value; },
      isDone: () => value === 'verify',
      send: (event, meta = {}) => {
        const from = value;
        value = transitions[value]?.[event] || value;
        run?.appendStateTransition?.({ from, to: value, event, ...meta });
        logger?.info?.({ from, to: value, event, ...meta }, 'fsm_transition');
        return value;
      }
    };
  }

  const machine = createMachine({
    id: 'browser-subagent-apply',
    initial,
    states: {
      research: { on: { RESEARCH_DONE: 'fill', SKIP_RESEARCH: 'fill', FAIL: 'verify' } },
      fill: { on: { NEED_MORE_FILL: 'fill', REVIEW: 'review', SUBMIT_READY: 'submit', FINISH: 'verify', FAIL: 'verify' } },
      review: { on: { NEED_MORE_FILL: 'fill', SUBMIT_READY: 'submit', VERIFIED: 'verify', FAIL: 'verify' } },
      submit: { on: { SUBMITTED: 'verify', NEED_MORE_FILL: 'fill', FAIL: 'verify' } },
      verify: { type: 'final' }
    }
  });

  const actor = createActor(machine).start();
  return {
    get state() { return actor.getSnapshot().value; },
    isDone: () => actor.getSnapshot().status === 'done' || actor.getSnapshot().value === 'verify',
    send: (event, meta = {}) => {
      const from = actor.getSnapshot().value;
      actor.send({ type: event });
      const to = actor.getSnapshot().value;
      run?.appendStateTransition?.({ from, to, event, ...meta });
      logger?.info?.({ from, to, event, ...meta }, 'fsm_transition');
      return to;
    }
  };
}
