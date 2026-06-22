import { scrapePageState } from '../apply/scraper.js';

export async function buildObservation(page, consoleBuffer = null) {
  const pageState = await scrapePageState(page).catch(() => ({
    url: page.url ? page.url() : '',
    title: '',
    pageText: '',
    fields: [],
    checkboxGroups: {},
    canvases: [],
    buttons: []
  }));

  const ariaSnapshot = (typeof page.ariaSnapshot === 'function')
    ? await page.ariaSnapshot().catch(() => null)
    : null;

  const consoleTail = consoleBuffer ? consoleBuffer.getBuffer() : [];

  // scrapePageState caps pageText at 3000 chars (fine for forms, useless for
  // feeds/lists/articles). Capture the full visible text separately so read-and-
  // extract tasks can actually see more than the first item.
  const fullText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const pageText = fullText.length > (pageState.pageText || '').length
    ? fullText.replace(/\n{3,}/g, '\n\n').slice(0, 16000)
    : (pageState.pageText || '');

  return {
    url: pageState.url,
    title: pageState.title,
    fields: pageState.fields || [],
    buttons: pageState.buttons || [],
    checkboxGroups: pageState.checkboxGroups || {},
    canvases: pageState.canvases || [],
    pageText,
    ariaSnapshot: ariaSnapshot ? ariaSnapshot.slice(0, 6000) : null,
    consoleTail
  };
}
