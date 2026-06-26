import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeSelector, idFromLegacySelector } from '../src/apply/selector.js';

test('dotted IDs use escape-proof attribute selectors', () => {
  assert.equal(
    attributeSelector('id', 'Job_specific_questions_200035201_1-1.0'),
    "[id='Job_specific_questions_200035201_1-1.0']",
  );
});

test('legacy CSS id selectors can be recovered for fallback lookup', () => {
  assert.equal(idFromLegacySelector('#question-1-1.0'), 'question-1-1.0');
  assert.equal(idFromLegacySelector('#question-1-1\\.0'), 'question-1-1.0');
});
