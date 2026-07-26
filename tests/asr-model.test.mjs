import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ASR_MODEL, resolveAsrModel } from '../public/src/asr-client.js';

// The model arrives in a URL, so this is an allow-list rather than a
// pass-through: an unrecognised value must fall back to the default, never be
// forwarded to OpenAI as-is.

test('defaults to whisper-1 when nothing is requested', () => {
  assert.equal(resolveAsrModel(''), 'whisper-1');
  assert.equal(resolveAsrModel('?studentId=sdt_1'), 'whisper-1');
  assert.equal(DEFAULT_ASR_MODEL, 'whisper-1');
});

test('accepts every supported model', () => {
  for (const model of [
    'whisper-1',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
    'gpt-4o-mini-transcribe-2025-12-15',
  ]) {
    assert.equal(resolveAsrModel(`?asrModel=${model}`), model);
  }
});

test('falls back rather than forwarding an unknown model', () => {
  for (const bogus of ['gpt-9', 'whisper-2', 'nonsense', 'gpt-4o-mini-transcrbe']) {
    assert.equal(
      resolveAsrModel(`?asrModel=${bogus}`),
      'whisper-1',
      `"${bogus}" should not reach the API`
    );
  }
});

test('refuses the diarize model — it needs a different request shape entirely', () => {
  // diarized_json + chunking_strategy + no prompt support. Allowing it here
  // would send a request this client does not know how to build or parse.
  assert.equal(resolveAsrModel('?asrModel=gpt-4o-transcribe-diarize'), 'whisper-1');
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
