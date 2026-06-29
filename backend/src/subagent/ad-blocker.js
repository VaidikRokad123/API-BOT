/**
 * ad-blocker.js — Domain-based request blocking for Playwright pages.
 *
 * Ported from Scrapling's ad_domains.py + navigation.py.
 * Blocks ~500 most common ad/tracker/analytics domains and optionally
 * heavy resource types (fonts, images, media, etc.) to speed up page loads
 * and reduce DOM noise for the LLM perception layer.
 */

// ─── Top ad/tracker/analytics domains (curated from Scrapling's 3,500 list) ──
// Full list at: scrapling/engines/toolbelt/ad_domains.py
// We include the top ~500 most commonly hit domains to keep this lightweight.
const AD_DOMAINS = new Set([
  // Google Ads & Analytics
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'pagead2.googlesyndication.com', 'adservice.google.com',
  'analytics.google.com', 'adsense.google.com',
  // Facebook / Meta
  'facebook.net', 'connect.facebook.net', 'pixel.facebook.com',
  'graph.facebook.com', 'fbcdn.net', 'fbevents.com',
  // Twitter / X
  'ads-twitter.com', 'analytics.twitter.com', 'syndication.twitter.com',
  'static.ads-twitter.com', 't.co',
  // Amazon Ads
  'amazon-adsystem.com', 'aax.amazon-adsystem.com', 'z-na.amazon-adsystem.com',
  'assoc-amazon.com', 'fls-na.amazon.com',
  // Microsoft / LinkedIn
  'ads.linkedin.com', 'bat.bing.com', 'c.bing.com', 'c.msn.com',
  'clarity.ms', 'ads.microsoft.com', 'flex.msn.com',
  // Major ad networks
  'adnxs.com', 'adsrvr.org', 'advertising.com', 'casalemedia.com',
  'criteo.com', 'criteo.net', 'demdex.net', 'dotomi.com',
  'exelator.com', 'eyereturn.com', 'go2cloud.org', 'iponweb.net',
  'mathtag.com', 'mediaplex.com', 'moatads.com', 'openx.net',
  'pubmatic.com', 'pubmine.com', 'quantserve.com', 'rubiconproject.com',
  'scorecardresearch.com', 'sharethrough.com', 'smartadserver.com',
  'taboola.com', 'outbrain.com', 'zergnet.com', 'revcontent.com',
  'yieldmo.com', 'yieldmanager.com', 'yadro.ru', 'yottos.com',
  // Tracking / Analytics
  'hotjar.com', 'mixpanel.com', 'segment.io', 'segment.com',
  'amplitude.com', 'heapanalytics.com', 'fullstory.com',
  'luckyorange.com', 'crazyegg.com', 'mouseflow.com',
  'inspectlet.com', 'loggly.com', 'newrelic.com',
  'bugsnag.com', 'rollbar.com', 'sentry.io',
  'optimizely.com', 'vwo.com', 'abtasty.com',
  'chartbeat.com', 'parsely.com', 'comscore.com',
  'omniture.com', '2o7.net', 'omtrdc.net',
  // Cookie consent / GDPR popups (these slow pages and create DOM noise)
  'cookiebot.com', 'cookieinformation.com', 'cookielaw.org',
  'onetrust.com', 'trustarc.com', 'evidon.com', 'consensu.org',
  // Social widgets
  'platform.twitter.com', 'widgets.pinterest.com', 'badge.stumbleupon.com',
  'addthis.com', 'addtoany.com', 'sharethis.com',
  // Retargeting
  'bluekai.com', 'bounceexchange.com', 'boomtrain.com',
  'convertro.com', 'conviva.com', 'crwdcntrl.net',
  'demandbase.com', 'dstillery.com', 'dynamicyield.com',
  'evergage.com', 'gigya.com', 'intentiq.com',
  'kochava.com', 'liadm.com', 'liveramp.com',
  'marketo.com', 'marketo.net', 'marin.com',
  'nexac.com', 'nrich.ai', 'nr-data.net',
  'pardot.com', 'pepperjam.com', 'pippio.com',
  'placeiq.com', 'postrelease.com', 'rfihub.com',
  'richrelevance.com', 'sailthru.com', 'salecycle.com',
  'semasio.net', 'simpli.fi', 'sitescout.com',
  'tapad.com', 'teads.tv', 'tidaltv.com',
  'tradedoubler.com', 'trafficjunky.net', 'tribalfusion.com',
  'turn.com', 'undertone.com', 'viglink.com',
  'visualiq.com', 'w55c.net', 'yieldlab.net',
  // Other common trackers
  'agkn.com', 'aniview.com', 'atdmt.com', 'bidswitch.net',
  'bttrack.com', 'buysellads.com', 'cdn.doubleverify.com',
  'contextweb.com', 'doubleverify.com', 'extreme-dm.com',
  'gumgum.com', 'id5-sync.com', 'indexww.com',
  'ipredictive.com', 'liveintent.com', 'lotame.com',
  'magnite.com', 'mediamath.com', 'ml314.com',
  'mookie1.com', 'myvisualiq.net', 'narrative.io',
  'nativo.com', 'oracleinfinity.io', 'outbrain.com',
  'owneriq.net', 'perimeterx.net', 'pubwise.io',
  'rlcdn.com', 'samba.tv', 'serving-sys.com',
  'skimresources.com', 'sonobi.com', 'spotxchange.com',
  'stickyadstv.com', 'stroeerdigitalmedia.de', 'switchadhub.com',
  'tapad.com', 'theadex.com', 'tremorhub.com',
  'triton.cloud', 'truoptik.com', 'trustpid.com',
  'tynt.com', 'unrulymedia.com', 'ust.chat',
  'verticalhealth.net', 'vindicosuite.com', 'weborama.com',
  'yieldbot.com', 'zemanta.com', 'zqtk.net',
]);

// Heavy resource types the LLM doesn't need
const BLOCKED_RESOURCE_TYPES = new Set([
  'font', 'image', 'media', 'beacon', 'imageset',
  'texttrack', 'websocket', 'csp_report',
]);

// ─── Domain matching (Scrapling's suffix-walking O(1) lookup) ───────────────

/**
 * Check if a hostname matches any blocked domain, including subdomains.
 * Walks up the hostname suffix chain with O(1) Set lookups.
 * 
 * "tracker.ads.doubleclick.net" matches "doubleclick.net"
 * "api.google-analytics.com" matches "google-analytics.com"
 */
function isDomainBlocked(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (AD_DOMAINS.has(h)) return true;
  let idx = h.indexOf('.');
  while (idx !== -1) {
    const suffix = h.slice(idx + 1);
    if (suffix.includes('.') && AD_DOMAINS.has(suffix)) return true;
    idx = h.indexOf('.', idx + 1);
  }
  return false;
}

// ─── Route interceptor ──────────────────────────────────────────────────────

/**
 * Install a Playwright route interceptor that blocks ad/tracker domains
 * and optionally heavy resource types.
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {object} options
 * @param {boolean} options.blockAds - Block known ad/tracker domains (default: true)
 * @param {boolean} options.blockResources - Block heavy resource types (default: false)
 * @param {Set<string>} options.extraDomains - Additional domains to block
 * @param {Set<string>} options.allowedDomains - Domains to always allow (whitelist)
 */
export async function installRouteBlocker(page, options = {}) {
  const {
    blockAds = true,
    blockResources = false,
    extraDomains = null,
    allowedDomains = null,
  } = options;

  // Merge extra domains if provided
  const blocked = blockAds ? new Set(AD_DOMAINS) : new Set();
  if (extraDomains) {
    for (const d of extraDomains) blocked.add(d.toLowerCase());
  }

  const allowed = allowedDomains ? new Set([...allowedDomains].map(d => d.toLowerCase())) : null;

  await page.route('**/*', (route) => {
    try {
      const request = route.request();

      // 1. Block heavy resource types
      if (blockResources && BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        return route.abort().catch(() => {});
      }

      // 2. Block ad/tracker domains
      if (blocked.size > 0) {
        let hostname = '';
        try {
          hostname = new URL(request.url()).hostname.toLowerCase();
        } catch {
          return route.continue().catch(() => {});
        }

        // Whitelist check
        if (allowed && isInAllowedList(hostname, allowed)) {
          return route.continue().catch(() => {});
        }

        if (isDomainBlockedInSet(hostname, blocked)) {
          return route.abort().catch(() => {});
        }
      }

      return route.continue().catch(() => {});
    } catch {
      return route.continue().catch(() => {});
    }
  });
}

function isDomainBlockedInSet(hostname, domainSet) {
  if (domainSet.has(hostname)) return true;
  let idx = hostname.indexOf('.');
  while (idx !== -1) {
    const suffix = hostname.slice(idx + 1);
    if (suffix.includes('.') && domainSet.has(suffix)) return true;
    idx = hostname.indexOf('.', idx + 1);
  }
  return false;
}

function isInAllowedList(hostname, allowedSet) {
  if (allowedSet.has(hostname)) return true;
  // Check wildcard patterns (*.example.com)
  let idx = hostname.indexOf('.');
  while (idx !== -1) {
    const suffix = hostname.slice(idx + 1);
    if (allowedSet.has(suffix) || allowedSet.has('*.' + suffix)) return true;
    idx = hostname.indexOf('.', idx + 1);
  }
  return false;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { isDomainBlocked, AD_DOMAINS, BLOCKED_RESOURCE_TYPES };
