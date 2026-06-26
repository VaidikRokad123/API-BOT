let pinoFactory = null;

async function getPino() {
  if (pinoFactory !== null) return pinoFactory;
  try {
    const mod = await import('pino');
    pinoFactory = mod.default || mod;
  } catch {
    pinoFactory = false;
  }
  return pinoFactory;
}

function fallbackLogger(bindings = {}) {
  const emit = (level, obj = {}, msg = '') => {
    const payload = {
      level,
      time: new Date().toISOString(),
      ...bindings,
      ...(typeof obj === 'object' ? obj : { value: obj }),
      msg
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };
  return {
    child: (more) => fallbackLogger({ ...bindings, ...more }),
    info: (obj, msg) => emit('info', obj, msg),
    warn: (obj, msg) => emit('warn', obj, msg),
    error: (obj, msg) => emit('error', obj, msg),
    debug: (obj, msg) => emit('debug', obj, msg)
  };
}

export async function createRunLogger(runId, state = 'init') {
  const pino = await getPino();
  const bindings = { run_id: runId, state };
  if (!pino) return fallbackLogger(bindings);
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime
  }).child(bindings);
}
