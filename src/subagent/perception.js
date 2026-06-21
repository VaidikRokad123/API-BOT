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

  return {
    url: pageState.url,
    title: pageState.title,
    fields: pageState.fields || [],
    buttons: pageState.buttons || [],
    checkboxGroups: pageState.checkboxGroups || {},
    canvases: pageState.canvases || [],
    pageText: pageState.pageText || '',
    ariaSnapshot: ariaSnapshot ? ariaSnapshot.slice(0, 6000) : null,
    consoleTail
  };
}
