export function attachConsoleCapture(page) {
  const maxLogs = 15;
  const buffer = [];

  if (typeof page.on === 'function') {
    page.on('console', msg => {
      const type = msg.type ? msg.type() : 'log';
      const text = msg.text ? msg.text() : String(msg);
      if (type === 'error' || type === 'warning' || type === 'warn') {
        buffer.push(`[Console ${type.toUpperCase()}] ${text}`);
        if (buffer.length > maxLogs) buffer.shift();
      }
    });

    page.on('pageerror', err => {
      buffer.push(`[Page Error] ${err.message || err}`);
      if (buffer.length > maxLogs) buffer.shift();
    });

    page.on('requestfailed', req => {
      const url = req.url ? req.url() : 'unknown URL';
      const fail = req.failure ? req.failure() : null;
      const errorText = fail ? fail.errorText : 'failed';
      // Skip common analytics/ads request noise
      if (!url.includes('analytics') && !url.includes('telemetry') && !url.includes('doubleclick') && !url.includes('google-sync')) {
        buffer.push(`[Network Failure] ${url} - ${errorText}`);
        if (buffer.length > maxLogs) buffer.shift();
      }
    });
  }

  return {
    getBuffer: () => [...buffer],
    clear: () => { buffer.length = 0; }
  };
}
