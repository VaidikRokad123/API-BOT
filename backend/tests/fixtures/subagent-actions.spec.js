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
