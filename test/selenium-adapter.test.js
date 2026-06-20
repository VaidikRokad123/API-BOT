import test from 'node:test';
import assert from 'node:assert/strict';
import { SeleniumPage } from '../src/selenium-adapter.js';

test('Selenium evaluate awaits async browser functions', async () => {
  const driver = {
    executeAsyncScript(script, ...args) {
      return new Promise(resolve => {
        Function(script)(...args, resolve);
      });
    },
  };
  const page = new SeleniumPage(driver);
  const result = await page.evaluate(async value => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return { doubled: value * 2 };
  }, 21);
  assert.deepEqual(result, { doubled: 42 });
});
