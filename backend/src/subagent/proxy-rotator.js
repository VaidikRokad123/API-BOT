/**
 * proxy-rotator.js — Thread-safe proxy rotation with error detection.
 *
 * Ported from Scrapling's proxy_rotation.py.
 * Provides cyclic or custom proxy rotation for Playwright browser contexts,
 * with automatic detection of proxy-related errors for retry logic.
 */

// ─── Proxy error indicators (from Scrapling's _PROXY_ERROR_INDICATORS) ──────
const PROXY_ERROR_INDICATORS = [
  'net::err_proxy',
  'net::err_tunnel',
  'connection refused',
  'connection reset',
  'connection timed out',
  'failed to connect',
  'could not resolve proxy',
  'err_proxy_connection_failed',
  'err_connection_reset',
  'err_connection_timed_out',
];

/**
 * Check if an error is proxy-related.
 * Matches against known browser/network proxy error patterns.
 *
 * @param {Error|string} error
 * @returns {boolean}
 */
export function isProxyError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return PROXY_ERROR_INDICATORS.some(indicator => msg.includes(indicator));
}

/**
 * Cyclic rotation strategy — iterates through proxies sequentially, wrapping around.
 * @param {Array} proxies
 * @param {number} currentIndex
 * @returns {[any, number]} [proxy, nextIndex]
 */
export function cyclicRotation(proxies, currentIndex) {
  const idx = currentIndex % proxies.length;
  return [proxies[idx], (idx + 1) % proxies.length];
}

/**
 * ProxyRotator — manages a pool of proxies with pluggable rotation strategies.
 *
 * Usage:
 *   const rotator = new ProxyRotator([
 *     'http://proxy1:8080',
 *     'http://user:pass@proxy2:8080',
 *     { server: 'http://proxy3:8080', username: 'user', password: 'pass' },
 *   ]);
 *
 *   const proxy = rotator.next();
 *   // Use proxy in Playwright context:
 *   const context = await browser.newContext({ proxy: rotator.toPlaywright(proxy) });
 */
export class ProxyRotator {
  /**
   * @param {Array<string|{server:string, username?:string, password?:string}>} proxies
   * @param {Function} strategy - Rotation function: (proxies, index) => [proxy, nextIndex]
   */
  constructor(proxies, strategy = cyclicRotation) {
    if (!proxies || proxies.length === 0) {
      throw new Error('At least one proxy must be provided');
    }
    if (typeof strategy !== 'function') {
      throw new TypeError(`strategy must be a function, got ${typeof strategy}`);
    }

    this._proxies = [];
    this._strategy = strategy;
    this._currentIndex = 0;

    for (const proxy of proxies) {
      if (typeof proxy === 'string') {
        this._proxies.push(proxy);
      } else if (proxy && typeof proxy === 'object' && proxy.server) {
        this._proxies.push(proxy);
      } else {
        throw new TypeError(`Invalid proxy: ${JSON.stringify(proxy)}. Expected string URL or {server, username?, password?}`);
      }
    }
  }

  /**
   * Get the next proxy according to the rotation strategy.
   * @returns {string|object}
   */
  next() {
    const [proxy, nextIndex] = this._strategy(this._proxies, this._currentIndex);
    this._currentIndex = nextIndex;
    return proxy;
  }

  /**
   * Convert a proxy value to Playwright's expected format.
   * Playwright expects: { server: string, username?: string, password?: string }
   *
   * @param {string|object} proxy
   * @returns {object} Playwright-compatible proxy dict
   */
  toPlaywright(proxy) {
    if (!proxy) proxy = this.next();

    if (typeof proxy === 'object') {
      return {
        server: proxy.server,
        username: proxy.username || '',
        password: proxy.password || '',
      };
    }

    // Parse proxy URL string
    try {
      const url = new URL(proxy);
      const result = {
        server: `${url.protocol}//${url.hostname}`,
        username: url.username || '',
        password: url.password || '',
      };
      if (url.port) result.server += `:${url.port}`;
      return result;
    } catch {
      throw new Error(`Invalid proxy URL: ${proxy}`);
    }
  }

  /** @returns {number} Number of configured proxies */
  get size() {
    return this._proxies.length;
  }

  /** @returns {Array} Copy of all configured proxies */
  get proxies() {
    return [...this._proxies];
  }
}
