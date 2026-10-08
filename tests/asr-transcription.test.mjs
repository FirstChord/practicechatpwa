import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NO_DASHBOARD_MESSAGE, transcribeViaDashboard, WhisperASRClient } from '../public/src/asr-client.js';

// The browser sends audio to the dashboard and gets text back. It must never
// again hold an OpenAI key: that was the relay's /api-key, which gave the raw
// key to anyone who asked.

const audio = () => new Blob([new Uint8Array(64)], { type: 'audio/webm;codecs=opus' });

function fakeDashboard({ status = 200, payload = { text: '  Let It Be went well.  ' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

test('posts the recording to the dashboard with the shared secret, not to OpenAI', async () => {
  const { calls, fetchImpl } = fakeDashboard();
  const result = await transcribeViaDashboard({
    dashboardBaseUrl: 'https://dash.example',
    practiceChatSecret: 'shh',
    audioBlob: audio(),
    model: 'gpt-4o-mini-transcribe',
    prompt: 'Guitar. Let It Be.',
    fetchImpl
  });

  assert.deepEqual(result, { text: 'Let It Be went well.', model: 'gpt-4o-mini-transcribe' });
  assert.equal(calls[0].url, 'https://dash.example/api/practice-notes/transcribe');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-FirstChord-PracticeChat-Secret'], 'shh');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  const body = calls[0].init.body;
  assert.equal(body.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(body.get('prompt'), 'Guitar. Let It Be.');
  assert.equal(body.get('file').size, 64);
});

test('reports the model the dashboard actually used when it fell back', async () => {
  const { fetchImpl } = fakeDashboard({ payload: { text: 'Hi.', model: 'whisper-1' } });
  const result = await transcribeViaDashboard({ dashboardBaseUrl: 'https://dash.example', audioBlob: audio(), model: 'gpt-9-transcribe', fetchImpl });
  assert.equal(result.model, 'whisper-1');
});

test('leaves out an empty prompt', async () => {
  const { calls, fetchImpl } = fakeDashboard();
  await transcribeViaDashboard({ dashboardBaseUrl: 'https://dash.example', audioBlob: audio(), fetchImpl });
  assert.equal(calls[0].init.body.has('prompt'), false);
});

test('shows the dashboard’s own error message, such as the out-of-credit one', async () => {
  const { fetchImpl } = fakeDashboard({ status: 503, payload: { error: 'Transcription paused: the OpenAI credit needs topping up.' } });
  await assert.rejects(
    transcribeViaDashboard({ dashboardBaseUrl: 'https://dash.example', audioBlob: audio(), fetchImpl }),
    /credit needs topping up/
  );
});

test('without dashboard context, recording refuses before the microphone opens', async () => {
  await assert.rejects(transcribeViaDashboard({ audioBlob: audio(), fetchImpl: fakeDashboard().fetchImpl }), { message: NO_DASHBOARD_MESSAGE });

  const client = new WhisperASRClient({});
  let reported = null;
  client.onError = (error) => { reported = error; };
  // No navigator in node: reaching getUserMedia would throw a different error.
  await assert.rejects(client.start(), { message: NO_DASHBOARD_MESSAGE });
  assert.equal(reported?.message, NO_DASHBOARD_MESSAGE);
});

test('no browser module fetches an API key or calls OpenAI directly', () => {
  const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'src');
  for (const file of readdirSync(srcDir).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(path.join(srcDir, file), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(source, /api\.openai\.com/, `${file} calls OpenAI from the browser`);
    assert.doesNotMatch(source, /\/api-key/, `${file} fetches an API key`);
    assert.doesNotMatch(source, /Bearer /, `${file} sends a bearer token`);
  }
});
