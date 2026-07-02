/**
 * HTML Cleanup Pipeline (inspired by ScrapeGraphAI's cleanup_html.py)
 * Runs inside the browser context to clean and minify the DOM into Markdown.
 */

export async function scrapeJobPage(page) {
  try {
    const result = await page.evaluate(() => {
      const title = document.title || '';

      // 1. Extract JSON-LD structured data
      const jsonLdData = [];
      const jsonLdTags = document.querySelectorAll('script[type="application/ld+json"]');
      for (const tag of jsonLdTags) {
        if (tag.textContent) {
          try {
            const data = JSON.parse(tag.textContent);
            if (data) {
              jsonLdData.push(data);
            }
          } catch (e) {
            // ignore malformed JSON-LD
          }
        }
      }

      // 2. Helper to check element visibility
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && 
               style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0';
      };

      // 3. Elements to exclude
      const excludeTags = new Set(['script', 'style', 'nav', 'header', 'footer', 'iframe', 'noscript', 'svg', 'canvas']);
      
      const isAdOrNoise = (el) => {
        const id = el.id ? el.id.toLowerCase() : '';
        const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
        
        if (id.includes('ad-') || className.includes('ad-')) return true;
        if (id.includes('banner') || className.includes('banner')) return true;
        if (id.includes('cookie') || className.includes('cookie')) return true;
        if (id.includes('header') || className.includes('header')) return true;
        if (id.includes('footer') || className.includes('footer')) return true;
        if (el.matches('ins.adsbygoogle, .google-ads, .ad-box, .advertisement, .privacy-policy, .consent-banner')) return true;
        return false;
      };

      // 4. Clean DOM traversal to markdown-like representation
      function cleanTraverse(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent.replace(/\s+/g, ' ');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }

        const el = node;
        const tag = el.tagName.toLowerCase();

        if (excludeTags.has(tag) || !isVisible(el) || isAdOrNoise(el)) {
          return '';
        }

        let childrenText = '';
        for (const child of Array.from(el.childNodes)) {
          childrenText += cleanTraverse(child);
        }
        childrenText = childrenText.trim();

        if (!childrenText) {
          return '';
        }

        // Structural mappings to markdown
        if (['h1', 'h2', 'h3'].includes(tag)) {
          return `\n\n# ${childrenText}\n\n`;
        }
        if (['h4', 'h5', 'h6'].includes(tag)) {
          return `\n\n## ${childrenText}\n\n`;
        }
        if (tag === 'p') {
          return `\n\n${childrenText}\n\n`;
        }
        if (tag === 'br') {
          return '\n';
        }
        if (tag === 'li') {
          return `\n* ${childrenText}`;
        }
        if (tag === 'ul' || tag === 'ol') {
          return `\n${childrenText}\n`;
        }
        if (tag === 'a') {
          const href = el.getAttribute('href');
          if (href && href.startsWith('http')) {
            return ` [${childrenText}](${href}) `;
          }
          return ` ${childrenText} `;
        }
        if (['td', 'th'].includes(tag)) {
          return ` | ${childrenText} `;
        }
        if (tag === 'tr') {
          return `\n${childrenText} |\n`;
        }

        // Block elements get clean breaks
        const style = window.getComputedStyle(el);
        if (style.display === 'block' || style.display === 'flex' || style.display === 'grid') {
          return `\n${childrenText}\n`;
        }

        return childrenText;
      }

      const bodyText = document.body ? cleanTraverse(document.body) : '';
      
      // Clean duplicate whitespace and newlines
      const cleanedText = bodyText
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();

      return {
        title,
        jsonLd: jsonLdData.length > 0 ? JSON.stringify(jsonLdData, null, 2) : null,
        cleanedText
      };
    });

    return result;
  } catch (err) {
    console.warn('  [SCRAPER] Failed to clean HTML:', err.message);
    return {
      title: await page.title().catch(() => ''),
      jsonLd: null,
      cleanedText: await page.evaluate(() => document.body.innerText).catch(() => '')
    };
  }
}
