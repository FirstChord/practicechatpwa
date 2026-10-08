import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ASR_MODEL, resolveAsrModel } from '../public/src/asr-client.js';

// The dashboard owns the only model allow-list and falls back for anything it
// does not recognise, so this side forwards a requested model rather than
// judging it (a second list here could only drift and silently cancel a
// trial). It still refuses anything not shaped like a model name.

test('defaults to whisper-1 when nothing is requested', () => {
  assert.equal(resolveAsrModel(''), 'whisper-1');
  assert.equal(resolveAsrModel('?studentId=sdt_1'), 'whisper-1');
  assert.equal(DEFAULT_ASR_MODEL, 'whisper-1');
});

test('forwards any model-shaped name for the dashboard to judge', () => {
  for (const model of [
    'whisper-1',
    'gpt-4o-mini-transcribe-2025-12-15',
    // Not on the dashboard list today: forwarded, and the dashboard falls
    // back. Adding a model there is now the only edit a trial needs.
    'gpt-9-transcribe',
  ]) {
    assert.equal(resolveAsrModel(`?asrModel=${model}`), model);
  }
});

test('refuses values that are not shaped like a model name', () => {
  for (const bogus of ['a b', '<script>', '../etc', '-leading-dash', 'x'.repeat(65)]) {
    assert.equal(resolveAsrModel(`?asrModel=${encodeURIComponent(bogus)}`), 'whisper-1', bogus);
  }
});

test('ignores surrounding whitespace and other query params', () => {
  assert.equal(
    resolveAsrModel('?studentId=sdt_1&asrModel=%20gpt-4o-transcribe%20&tutor=Dean'),
    'gpt-4o-transcribe'
  );
});

test('an empty asrModel param is treated as absent', () => {
  assert.equal(resolveAsrModel('?asrModel='), 'whisper-1');
});
