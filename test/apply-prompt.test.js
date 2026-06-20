import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentPrompt, sanitizeGptJson } from '../src/apply/prompt.js';

test('answered choices cannot crowd an empty dropdown out of the AI prompt', () => {
  const fields = Array.from({ length: 45 }, (_, index) => ({
    label: `Answered ${index}`,
    type: 'checkbox',
    selector: `#answered-${index}`,
    checked: true,
  }));
  fields.push({
    label: 'State',
    type: 'select',
    selector: '#state',
    required: true,
    currentValue: '',
    options: [
      { text: 'Select an option', value: '0', isPlaceholder: true },
      { text: 'Gujarat', value: 'GJ', isPlaceholder: false },
    ],
  });

  const prompt = buildAgentPrompt({}, {
    url: 'https://jobs.example.com/apply', title: 'Apply', pageText: '', fields,
    checkboxGroups: {}, canvases: [], buttons: [],
  }, 1);

  assert.match(prompt, /"selector":"#state"/);
  assert.match(prompt, /"options":\["Gujarat"\]/);
  assert.doesNotMatch(prompt, /#answered-0/);
});

test('dotted field IDs survive the JSON action round-trip without CSS escapes', () => {
  const selector = "[id='Job_specific_questions_200035201_1-1.0']";
  const parsed = sanitizeGptJson(JSON.stringify({
    actions: [{ type: 'check', selector, value: 'No' }],
  }));
  assert.equal(parsed.actions[0].selector, selector);
});
