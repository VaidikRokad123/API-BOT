import test from 'node:test';
import assert from 'node:assert/strict';
import { findBestDropdownOption, findVerifiedDropdownValue, isDropdownPlaceholder, normalizeDropdownText } from '../src/apply/dropdown.js';

const options = values => values.map(([text, value = text]) => ({ text, value }));

test('normalizes punctuation, accents, and whitespace', () => {
  assert.equal(normalizeDropdownText('  R&D — Montréal  '), 'r and d montreal');
});

test('prefers an exact option label', () => {
  const match = findBestDropdownOption(options([['India'], ['Indiana'], ['Indonesia']]), 'India');
  assert.equal(match.text, 'India');
});

test('matches an exact underlying option value', () => {
  const match = findBestDropdownOption(options([['Gujarat', 'GJ'], ['Goa', 'GA']]), 'GJ');
  assert.equal(match.text, 'Gujarat');
});

test('allows a unique label with extra parenthetical detail', () => {
  const match = findBestDropdownOption(options([['United States (+1)'], ['United Kingdom (+44)']]), 'United States');
  assert.equal(match.text, 'United States (+1)');
});

test('does not guess when a short answer is ambiguous', () => {
  const match = findBestDropdownOption(options([
    ['No, I do not require sponsorship'],
    ['No, I am not a protected veteran'],
  ]), 'No');
  assert.equal(match, null);
});

test('ignores placeholder and disabled options', () => {
  const match = findBestDropdownOption([
    { text: 'India', value: '', isPlaceholder: true },
    { text: 'India', value: 'IN', disabled: true },
  ], 'India');
  assert.equal(match, null);
});

test('recognizes placeholder labels even when their value is non-empty', () => {
  assert.equal(isDropdownPlaceholder({ text: 'Select an option', value: '0' }), true);
  assert.equal(isDropdownPlaceholder({ text: 'Please choose your state', value: 'unselected' }), true);
  assert.equal(isDropdownPlaceholder({ text: 'Gujarat', value: 'GJ' }), false);
});

test('does not report a custom selection unless the widget reflects it', () => {
  assert.equal(findVerifiedDropdownValue(['Select an option', 'State'], 'California'), null);
  assert.equal(findVerifiedDropdownValue(['California'], 'California'), 'California');
});
