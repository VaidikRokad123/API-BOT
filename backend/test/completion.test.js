import test from 'node:test';
import assert from 'node:assert/strict';
import { isSubmissionConfirmed } from '../src/apply/completion.js';

test('does not treat a visible application form as completed', () => {
  assert.equal(isSubmissionConfirmed({
    url: 'https://jobs.example.com/application/123',
    pageText: 'Application form State Select an option',
    buttons: [{ text: 'Submit application', disabled: false }],
  }), false);
});

test('requires explicit confirmation text or a confirmation URL', () => {
  assert.equal(isSubmissionConfirmed({
    url: 'https://jobs.example.com/application/123',
    pageText: 'Thank you for applying. We have received your application.',
    buttons: [],
  }), true);
  assert.equal(isSubmissionConfirmed({
    url: 'https://jobs.example.com/application/confirmation',
    pageText: 'Complete',
    buttons: [],
  }), true);
});
