import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkNoteSafety,
  cleanupSpeechText,
  enhancedCleanupSpeechText,
} from '../public/src/text-processor.js';

// --- Regression fixtures -----------------------------------------------------
// Each of these was corrupted by the unanchored string-built patterns the rules
// used before 2026-07-24. They are the reason the rule table is regex-anchored.

test('leaves innocent words containing rule fragments alone', () => {
  const cases = [
    ['We worked on topics from the funk rhythm section', 'topics'],
    ['The plectrum was in the picture', 'plectrum'],
    ['He was off minus two frets', 'off minus'],
    ['She finished the assignment', 'assignment'],
    ['We played the bassline', 'bassline'],
  ];

  for (const [input, mustSurvive] of cases) {
    assert.ok(
      cleanupSpeechText(input).includes(mustSurvive),
      `"${mustSurvive}" was corrupted in: ${cleanupSpeechText(input)}`
    );
  }
});

test('does not mangle capitalisation mid-word', () => {
  assert.equal(cleanupSpeechText('He was off minus two frets'), 'He was off minus two frets.');
  assert.ok(!cleanupSpeechText('A lot of minus signs').includes('oF'));
});

test('keeps meaningful repetition but removes stutters', () => {
  assert.equal(cleanupSpeechText('no no she did well'), 'No no she did well.');
  assert.equal(cleanupSpeechText('that was very very good'), 'That was very very good.');
  assert.equal(cleanupSpeechText('we we worked on the the scale'), 'We worked on the scale.');
});

test('keeps content-bearing words the old filler list removed', () => {
  const kept = ['actually', 'basically', 'kind of', 'I mean', 'sort of', 'you know'];
  for (const phrase of kept) {
    const input = `She ${phrase} managed the whole piece`;
    assert.ok(
      cleanupSpeechText(input).toLowerCase().includes(phrase.toLowerCase()),
      `"${phrase}" was stripped from: ${cleanupSpeechText(input)}`
    );
  }
});

// --- Intended corrections ----------------------------------------------------

test('applies music terminology fixes on whole words', () => {
  const cases = [
    ['we did a bar chord today', 'barre chord'],
    ['practise the f minus scale', 'F minor'],
    ['work on the fret board', 'fretboard'],
    ['try some finger picking', 'fingerpicking'],
    ['use a plec', 'pick'],
    ['count the ate notes', 'eighth notes'],
    ['play the six teeth note run', 'sixteenth note'],
    ['go back to the door in mode', 'Dorian mode'],
    ['that cave dance sounded good', 'cadence'],
    ['a nice down stroke', 'downstroke'],
  ];

  for (const [input, expected] of cases) {
    assert.ok(
      cleanupSpeechText(input).includes(expected),
      `expected "${expected}" in: ${cleanupSpeechText(input)}`
    );
  }
});

test('removes disfluencies and tidies punctuation', () => {
  assert.equal(cleanupSpeechText('um we did er the C chord'), 'We did the C chord.');
  assert.equal(cleanupSpeechText('she did well'), 'She did well.');
  assert.equal(cleanupSpeechText('great work!'), 'Great work!');
});

test('normalises informal contractions', () => {
  assert.equal(cleanupSpeechText('you gonna practise this'), 'You going to practise this.');
  assert.equal(cleanupSpeechText('she gotta slow it down'), 'She need to slow it down.');
});

test('returns input unchanged when empty', () => {
  assert.deepEqual(enhancedCleanupSpeechText(''), { text: '', enhancements: [] });
  assert.deepEqual(enhancedCleanupSpeechText(null), { text: '', enhancements: [] });
});

test('reports what it changed', () => {
  const result = enhancedCleanupSpeechText('um we did the C chord');
  assert.ok(result.enhancements.includes('Removed filler words'));
});

// --- Safety gate -------------------------------------------------------------

test('checkNoteSafety passes an ordinary lesson note', () => {
  const note = 'We worked on the funk rhythm and the C to G change. Great session.';
  assert.deepEqual(checkNoteSafety(note), { ok: true, findings: [] });
});

test('checkNoteSafety flags a likely mis-transcription with a hint', () => {
  const result = checkNoteSafety('We worked on the fuck rhythm today');
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].likelyMeant, 'funk');
});

test('checkNoteSafety never rewrites the text it checks', () => {
  const note = 'We worked on the fuck rhythm today';
  checkNoteSafety(note);
  assert.equal(note, 'We worked on the fuck rhythm today');
});

test('checkNoteSafety does not fire on music words containing risky fragments', () => {
  const safe = [
    'We played the bass line',
    'She finished the assignment early',
    'Great class today',
    'We used a shaker',
    'The pitch was spot on',
  ];
  for (const note of safe) {
    assert.equal(checkNoteSafety(note).ok, true, `false positive on: ${note}`);
  }
});

test('checkNoteSafety deduplicates repeated findings', () => {
  const result = checkNoteSafety('shit and more shit');
  assert.equal(result.findings.length, 1);
});

test('checkNoteSafety is stable across repeated calls', () => {
  const note = 'We worked on the fuck rhythm today';
  assert.deepEqual(checkNoteSafety(note), checkNoteSafety(note));
});
