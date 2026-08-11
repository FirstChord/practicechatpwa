import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildSessionPayload,
    createSession,
    markPhase,
    markStep,
    measureEdit,
    recordAsrError,
    recordRating,
    recordReRecord,
    recordSafety,
    recordSkip,
    recordSongs,
    recordingStarted,
    recordingStopped,
    shouldFlushOnHide,
    shouldPromptForRating,
    transcriptReceived,
} from '../public/src/session-telemetry.js';

const T0 = 1_754_000_000_000;

function newSession(overrides = {}) {
    return createSession({
        context: { studentId: 'sdt_1', tutor: 'Finn', ...overrides },
        asrModel: 'whisper-1',
        buildVersion: 'test-build',
        now: T0,
    });
}

test('a session starts with an id and knows nothing else yet', () => {
    const session = newSession();
    assert.match(session.sessionId, /^pcs_/);
    assert.equal(session.phase, 'opened');
    assert.equal(session.firstRecordAtMs, null);

    const payload = buildSessionPayload(session);
    assert.equal(payload.msActive, '');
    assert.equal(payload.msToFirstRecord, '');
    assert.equal(payload.questionsAnswered, 0);
});

test('the payload never carries note text, transcript or audio', () => {
    const session = newSession();
    recordingStarted(session, 0, T0 + 1000);
    recordingStopped(session, 0, T0 + 9000);
    transcriptReceived(session, 0, 'We worked on Clocks and the student found the chorus hard', T0 + 11000);
    measureEdit(session, { generated: 'the generated note', final: 'the tutor edited note' });

    const wire = JSON.stringify(buildSessionPayload(session));
    assert.equal(wire.includes('Clocks'), false);
    assert.equal(wire.includes('chorus'), false);
    assert.equal(wire.includes('generated note'), false);
    // Only the length of what was said survives.
    assert.equal(buildSessionPayload(session).steps[0].chars, 57);
});

test('capture time and provider latency are measured separately', () => {
    // Ninety seconds of a tutor talking and nine seconds of OpenAI thinking are
    // different findings; only the second is a reason to change anything.
    const session = newSession();
    recordingStarted(session, 0, T0 + 1000);
    recordingStopped(session, 0, T0 + 91000);
    transcriptReceived(session, 0, 'text', T0 + 100000);

    const payload = buildSessionPayload(session);
    assert.equal(payload.steps[0].recordMs, 90000);
    assert.equal(payload.steps[0].transcribeMs, 9000);
    assert.equal(payload.msCaptureTotal, 90000);
    assert.equal(payload.msTranscribeTotal, 9000);
});

test('active time runs from the first recording, not from opening the panel', () => {
    // A panel opened at the start of a lesson and finished at the end would
    // otherwise report the lesson as the ritual's duration.
    const session = newSession();
    const thirtyMinutes = 30 * 60 * 1000;
    recordingStarted(session, 0, T0 + thirtyMinutes);
    recordingStopped(session, 0, T0 + thirtyMinutes + 10000);
    transcriptReceived(session, 0, 'text', T0 + thirtyMinutes + 12000);
    markPhase(session, 'note_generated', T0 + thirtyMinutes + 60000);
    markPhase(session, 'finished', T0 + thirtyMinutes + 90000);

    const payload = buildSessionPayload(session);
    assert.equal(payload.msActive, 90000, 'first record -> finished');
    assert.equal(payload.msSessionTotal, thirtyMinutes + 90000, 'opened -> finished, kept as context');
    assert.equal(payload.msToFirstRecord, thirtyMinutes);
});

test('a forgotten open mic cannot dominate the timings', () => {
    const session = newSession();
    recordingStarted(session, 0, T0);
    recordingStopped(session, 0, T0 + 6 * 60 * 60 * 1000);
    assert.equal(buildSessionPayload(session).steps[0].recordMs, 4 * 60 * 60 * 1000);
});

test('re-records are counted apart from transcription errors', () => {
    // Conflating them would report the most careful tutor in the school as the
    // one having the most trouble.
    const session = newSession();
    recordAsrError(session, 0);
    recordReRecord(session, 1);
    recordReRecord(session, 1);

    const payload = buildSessionPayload(session);
    assert.equal(payload.asrErrorCount, 1);
    assert.equal(payload.reRecordCount, 2);
    assert.equal(payload.steps.find((s) => s.q === 1).errors, 1);
    assert.equal(payload.steps.find((s) => s.q === 2).reRecorded, 2);
});

test('an error clears the in-flight timers so the next attempt is not charged for it', () => {
    const session = newSession();
    recordingStarted(session, 0, T0);
    recordAsrError(session, 0);
    assert.equal(session.recordingStartedAtMs, null);
    assert.equal(session.transcribeStartedAtMs, null);

    // The retry measures only itself.
    recordingStarted(session, 0, T0 + 60000);
    recordingStopped(session, 0, T0 + 65000);
    assert.equal(buildSessionPayload(session).steps[0].recordMs, 5000);
});

test('the last step reached is tracked, but abandonment is never claimed', () => {
    const session = newSession();
    markStep(session, 1);
    const payload = buildSessionPayload(session);
    assert.equal(payload.lastStep, 'q2');
    // 'abandoned' is the dashboard's word, derived from age. A client that died
    // cannot report that it gave up.
    assert.notEqual(payload.phase, 'abandoned');
    assert.equal(payload.phase, 'opened');
});

test('whitespace churn from contenteditable is not an edit', () => {
    const session = newSession();
    measureEdit(session, {
        generated: '[What we did]\nScales\n\n[Practice Goals]\nBar 4',
        final: '[What we did]  Scales   [Practice Goals] Bar 4',
    });
    assert.equal(session.noteEdited, false);
    assert.equal(session.editCharDelta, 0);
});

test('an edit keeps its direction', () => {
    const trimmed = newSession();
    measureEdit(trimmed, { generated: 'a'.repeat(200), final: 'a'.repeat(150) });
    assert.equal(trimmed.noteEdited, true);
    assert.equal(trimmed.editCharDelta, -50);

    const expanded = newSession();
    measureEdit(expanded, { generated: 'a'.repeat(100), final: 'a'.repeat(160) });
    assert.equal(expanded.editCharDelta, 60);
});

test('skips and answers are counted from what actually happened', () => {
    const session = newSession();
    recordingStarted(session, 0, T0);
    recordingStopped(session, 0, T0 + 5000);
    transcriptReceived(session, 0, 'we did scales', T0 + 6000);
    recordSkip(session, 1);
    recordingStarted(session, 2, T0 + 10000);
    recordingStopped(session, 2, T0 + 15000);
    transcriptReceived(session, 2, 'practice bar four', T0 + 16000);

    const payload = buildSessionPayload(session);
    assert.equal(payload.questionsAnswered, 2);
    assert.equal(payload.questionsSkipped, 1);
});

test('an empty transcript is not a captured answer', () => {
    const session = newSession();
    recordingStarted(session, 0, T0);
    recordingStopped(session, 0, T0 + 3000);
    transcriptReceived(session, 0, '', T0 + 4000);
    assert.equal(buildSessionPayload(session).questionsAnswered, 0);
});

test('a skip records the score as blank but still stamps the time', () => {
    // So response rate stays measurable: a prompt people decline is a finding.
    const session = newSession();
    session.ratingPrompted = true;
    recordRating(session, { accuracy: '', comment: '', now: T0 });

    const payload = buildSessionPayload(session);
    assert.equal(payload.ratingPrompted, true);
    assert.equal(payload.ratingAccuracy, '');
    assert.ok(payload.ratingAnsweredAt);
});

test('only a whole 1-5 is accepted as a rating, and comments are capped', () => {
    for (const [input, expected] of [[1, 1], [5, 5], [0, ''], [6, ''], [3.5, ''], ['4', '']]) {
        const session = newSession();
        recordRating(session, { accuracy: input, now: T0 });
        assert.equal(session.ratingAccuracy, expected, `rating ${JSON.stringify(input)}`);
    }

    const session = newSession();
    recordRating(session, { accuracy: 4, comment: 'x'.repeat(500), now: T0 });
    assert.equal(session.ratingComment.length, 200);
});

test('the prompt never appears unless the server enabled it', () => {
    const session = newSession();
    assert.equal(shouldPromptForRating({ session, evalPrompt: false, evalSample: 1 }), false);
    assert.equal(shouldPromptForRating({ session: null, evalPrompt: true, evalSample: 1 }), false);
    assert.equal(shouldPromptForRating({ session, evalPrompt: true, evalSample: 1 }), true);
});

test('a tutor sees at most one prompt a day', () => {
    const session = newSession();
    assert.equal(
        shouldPromptForRating({ session, evalPrompt: true, evalSample: 1, lastPromptedOn: '2026-08-10', today: '2026-08-10' }),
        false,
    );
    assert.equal(
        shouldPromptForRating({ session, evalPrompt: true, evalSample: 1, lastPromptedOn: '2026-08-09', today: '2026-08-10' }),
        true,
    );
});

test('sampling is deterministic, so a re-render cannot re-roll it', () => {
    const session = newSession();
    const first = shouldPromptForRating({ session, evalPrompt: true, evalSample: 4, today: '2026-08-10' });
    for (let attempt = 0; attempt < 20; attempt += 1) {
        assert.equal(
            shouldPromptForRating({ session, evalPrompt: true, evalSample: 4, today: '2026-08-10' }),
            first,
        );
    }
});

test('songs and safety are counts and flags, never titles or words', () => {
    const session = newSession();
    recordSongs(session, { songIds: ['song_a', 'song_b'], unlistedTitles: ['Something Uncatalogued'] });
    recordSafety(session, { flags: 2, acknowledged: true });

    const payload = buildSessionPayload(session);
    assert.equal(payload.songsSelected, 2);
    assert.equal(payload.unlistedSongs, 1);
    assert.equal(payload.safetyFlagCount, 2);
    assert.equal(payload.safetyAck, true);
    const wire = JSON.stringify(payload);
    assert.equal(wire.includes('Something Uncatalogued'), false);
    assert.equal(wire.includes('song_a'), false);
});

test('prior-note context passes through as availability, not as review', () => {
    const session = newSession({ priorNoteExists: true, priorNoteAgeDays: 7, priorHistoryOpened: false });
    const payload = buildSessionPayload(session);
    assert.equal(payload.priorNoteExists, true);
    assert.equal(payload.priorNoteAgeDays, 7);
    // The dashboard renders the previous note automatically, so its presence is
    // never evidence that anyone read it.
    assert.equal(payload.priorHistoryOpened, false);
});

test('a typed note reports no capture time rather than zero', () => {
    // Blank and zero are different: one never recorded, the other recorded
    // nothing. Zero would drag every median down.
    const session = newSession();
    session.typedNotSpoken = true;
    markPhase(session, 'note_generated', T0 + 30000);

    const payload = buildSessionPayload(session);
    assert.equal(payload.typedNotSpoken, true);
    assert.equal(payload.msCaptureTotal, '');
    assert.equal(payload.msActive, '', 'no recording ever started');
});

test('a session cut short still produces a usable payload', () => {
    const session = newSession();
    recordingStarted(session, 0, T0 + 2000);
    const payload = buildSessionPayload(session);
    assert.equal(payload.phase, 'capturing');
    assert.equal(payload.lastStep, 'q1');
    assert.equal(payload.msToFirstRecord, 2000);
    assert.equal(payload.msActive, '', 'never finished, so there is no active total to claim');
});

test('a finished-but-unsent session still flushes when the page closes', () => {
    // Found by driving the real app in a browser. `finishSession` marks the
    // session finished and then holds the send so the tutor's rating can ride
    // on the same row — so "flush unless it finished" would drop the finished
    // write whenever a sampled tutor closed the panel without answering. The
    // lesson would have been recorded as abandoned at review, and only ever for
    // sampled sessions, quietly biasing completion against the very sessions
    // carrying the ratings.
    assert.equal(shouldFlushOnHide({ sentPhase: 'note_generated', phase: 'finished' }), true);

    // Already told: nothing owed.
    assert.equal(shouldFlushOnHide({ sentPhase: 'finished', phase: 'finished' }), false);
    assert.equal(shouldFlushOnHide({ sentPhase: 'opened', phase: 'opened' }), false);

    // Abandoned mid-ritual: the server is behind, so flush.
    assert.equal(shouldFlushOnHide({ sentPhase: 'opened', phase: 'capturing' }), true);

    // Nothing sent at all yet.
    assert.equal(shouldFlushOnHide({ sentPhase: '', phase: 'opened' }), true);
});

test('every telemetry function tolerates a null session', () => {
    // Telemetry must never be the reason a lesson fails. If the session was
    // never created — no dashboard context, or something threw — every call
    // still has to be a no-op.
    const calls = [
        () => markPhase(null, 'finished'),
        () => markStep(null, 0),
        () => recordingStarted(null, 0),
        () => recordingStopped(null, 0),
        () => transcriptReceived(null, 0, 'x'),
        () => recordAsrError(null, 0),
        () => recordReRecord(null, 0),
        () => recordSkip(null, 0),
        () => measureEdit(null, { generated: 'a', final: 'b' }),
        () => recordSafety(null, { flags: 1 }),
        () => recordSongs(null, { songIds: [] }),
        () => recordRating(null, { accuracy: 3 }),
        () => buildSessionPayload(null),
    ];
    for (const call of calls) {
        assert.doesNotThrow(call);
    }
});
