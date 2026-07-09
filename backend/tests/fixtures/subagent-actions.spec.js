import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'url';
import path from 'path';
import { act, perceive } from '../../src/subagent/engine.js';

function fixtureUrl(name) {
  return pathToFileURL(path.join(process.cwd(), 'tests', 'fixtures', 'pages', name)).href;
}

test('native select exposes full option list and selects by visible label', async ({ page }) => {
  await page.goto(fixtureUrl('native-select.html'));
  const obs = await perceive(page);
  expect(obs.elementList).toContain('Engineer');
  await act(page, { type: 'select', selector: '#role', value: 'Engineer', optionKind: 'native_select' });
  await expect(page.locator('#role')).toHaveValue('eng');
});

test('custom ARIA combobox selects an option without treating it as native select', async ({ page }) => {
  await page.goto(fixtureUrl('custom-combobox.html'));
  const obs = await perceive(page);
  expect(obs.elementList).toContain('dropdown=custom_combobox');
  await act(page, { type: 'select', selector: '#country', value: 'Canada', optionKind: 'custom_combobox' });
  await expect(page.locator('#country-value')).toHaveValue('ca');
});

test('counter widget click updates application state', async ({ page }) => {
  await page.goto(fixtureUrl('counter-widget.html'));
  await act(page, { type: 'click', selector: '#inc' });
  await act(page, { type: 'click', selector: '#inc' });
  await expect(page.locator('#count')).toHaveText('2');
});

test('canvas signature pad receives pointer strokes', async ({ page }) => {
  await page.goto(fixtureUrl('signature-pad.html'));
  await act(page, { type: 'signature', selector: '#sig' });
  const inkedPixels = await page.evaluate(() => {
    const canvas = document.getElementById('sig');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
    return count;
  });
  expect(inkedPixels).toBeGreaterThan(0);
});

test('multi-page next flow waits for revealed conditional fields', async ({ page }) => {
  await page.goto(fixtureUrl('multi-page-flow.html'));
  await act(page, { type: 'fill', selector: '#first', value: 'Ada' });
  await act(page, { type: 'click', selector: '#next' });
  await expect(page.locator('#email')).toBeVisible();
  await act(page, { type: 'fill', selector: '#email', value: 'ada@example.com' });
  await expect(page.locator('#email')).toHaveValue('ada@example.com');
});

test('native confirm dialog auto-accepted does not block click', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto(fixtureUrl('dialog-confirm.html'));
  await act(page, { type: 'click', selector: '#confirm-btn' });
  await expect(page.locator('#status')).toHaveText('confirmed');
});

// ─── Regression tests for silent fill/type failures ─────────────────────────

test('fill on plain textarea verifies read-back matches', async ({ page }) => {
  await page.goto(fixtureUrl('plain-textarea.html'));
  await act(page, { type: 'fill', selector: '#message', value: 'Hello, World!' });
  await expect(page.locator('#message')).toHaveValue('Hello, World!');
  // Also verify the char-count listener saw the input event
  await expect(page.locator('#char-count')).toHaveText('13');
});

test('fill on contenteditable div verifies read-back matches', async ({ page }) => {
  await page.goto(fixtureUrl('contenteditable-composer.html'));
  const obs = await perceive(page);
  const composerEl = obs.elements.find(e => e.name === 'Message input' || e.ref);
  expect(composerEl).toBeTruthy();
  await act(page, { type: 'fill', selector: '#composer', value: 'Test message for rich editor' });
  // Verify text actually appears in the contenteditable div
  const text = await page.locator('#composer').innerText();
  expect(text).toContain('Test message for rich editor');
  // Verify the output mirror got the event
  await expect(page.locator('#output')).toHaveText('Test message for rich editor');
});

test('fill on React-controlled input with debounced re-render still succeeds', async ({ page }) => {
  await page.goto(fixtureUrl('react-controlled-input.html'));
  await act(page, { type: 'fill', selector: '#controlled', value: 'React value' });
  // Wait for the debounced re-render (50ms in the fixture)
  await page.waitForTimeout(200);
  // The display should show the controlled value
  await expect(page.locator('#display')).toHaveText('React value');
  // The input itself should still have the value
  await expect(page.locator('#controlled')).toHaveValue('React value');
});

test('ref re-injection after simulated DOM re-render finds element', async ({ page }) => {
  await page.goto(fixtureUrl('plain-textarea.html'));
  // First perceive to inject refs
  const obs1 = await perceive(page);
  const messageEl = obs1.elements.find(e => e.tag === 'textarea');
  expect(messageEl).toBeTruthy();
  expect(messageEl.ref).toMatch(/^gpt-ref-\d+$/);

  // Simulate React stripping the injected data attribute
  await page.evaluate(() => {
    const el = document.querySelector('#message');
    if (el) delete el.dataset.gptAuthRef;
  });

  // Verify the attribute is actually gone
  const hasAttr = await page.evaluate(() => {
    return !!document.querySelector('#message').dataset.gptAuthRef;
  });
  expect(hasAttr).toBe(false);

  // Now act() should re-inject refs and still find the element
  await act(page, { type: 'fill', selector: '#message', value: 'After re-inject' });
  await expect(page.locator('#message')).toHaveValue('After re-inject');
});
