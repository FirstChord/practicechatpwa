// Practice Chat - Session Telemetry
//
// Measures the ritual without changing it. Six weeks of evidence on whether
// the end-of-lesson ritual is worth keeping, from the one place that can see
// the parts that fail: the app itself.
//
// The dashboard's Practice_Notes_Log only gains a row when a tutor reaches the
// end. So a tutor who gives up at question two, a transcription that errors, a
// note rewritten before saving — none of that exists anywhere today. This
// module holds the missing half in memory and hands it to the dashboard three
// times as a session progresses.
//
// Four rules it will not bend:
//
// 1. **It never carries content.** No audio, no transcript, no note text. Only
//    durations, counts and flags. The one free-text field is a comment the
//    tutor chose to type, capped at 200 characters.
// 2. **It never claims abandonment.** A browser closed mid-lesson cannot report
//    that it gave up. This records the furthest point reached; the dashboard
//    decides what an unfinished session means once it is old enough.
// 3. **It never fails a lesson.** Every value here is best-effort. A caller
//    that throws because telemetry broke would be worse than no telemetry.
// 4. **Clocks are only ever subtracted from themselves.** Every duration is a
//    delta between two readings of the same machine's clock, so a tutor's laptop
//    being twenty minutes fast cannot distort anything.

// A recording longer than this is a forgotten open mic, not an answer, and one
// such value would own the tail of a few hundred sessions. Matches the cap the
// dashboard applies on the way in.
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const MAX_COMMENT = 200;

function nowMs() {
    // performance.now() would be immune to wall-clock changes, but it resets on
    // page load and cannot produce the ISO timestamp the row needs. Date.now()
    // deltas are correct for everything at this timescale.
    return Date.now();
}

function boundedDuration(value) {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.min(Math.round(value), MAX_DURATION_MS);
}

/**
 * A new session. `sessionId` is generated here because nothing upstream has one
 * — the dashboard opens a URL, not a tracked session.
 */
export function createSession({ context = {}, asrModel = '', buildVersion = '', now = nowMs() } = {}) {
    return {
        sessionId: newSessionId(),
        openedAtMs: now,
        openedAt: new Date(now).toISOString(),
        studentId: context.studentId || '',
        tutor: context.tutor || '',
        asrModel,
        buildVersion,
        phase: 'opened',
        outcome: '',
        noteId: '',
        lastStep: '',
        typedNotSpoken: false,
        firstRecordAtMs: null,
        noteGeneratedAtMs: null,
        finishedAtMs: null,
        asrErrorCount: 0,
        reRecordCount: 0,
        safetyFlagCount: 0,
        safetyAck: false,
        noteEdited: false,
        editCharDelta: 0,
        songsSelected: 0,
        unlistedSongs: 0,
        // What the tutor had in front of them, as told to us by the dashboard.
        // "A previous note existed" is availability, never evidence of reading:
        // the dashboard renders it automatically on student select.
        priorNoteExists: Boolean(context.priorNoteExists),
        priorNoteAgeDays: context.priorNoteAgeDays,
        priorHistoryOpened: Boolean(context.priorHistoryOpened),
        ratingPrompted: false,
        ratingAccuracy: '',
        ratingComment: '',
        ratingAnsweredAt: '',
        steps: [],
        // Transient, never sent: where an in-progress recording started.
        recordingStartedAtMs: null,
        transcribeStartedAtMs: null,
    };
}

function newSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `pcs_${crypto.randomUUID()}`;
    }
    // Older WebKit. Uniqueness only has to hold across one school's lessons.
    return `pcs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function stepFor(session, questionIndex) {
    const number = questionIndex + 1;
    let step = session.steps.find((entry) => entry.q === number);
    if (!step) {
        step = { q: number, recordMs: null, transcribeMs: null, chars: null, errors: 0, skipped: false, reRecorded: 0 };
        session.steps.push(step);
        session.steps.sort((a, b) => a.q - b.q);
    }
    return step;
}

export function markPhase(session, phase, now = nowMs()) {
    if (!session) return session;
    session.phase = phase;
    if (phase === 'note_generated' && session.noteGeneratedAtMs === null) {
        session.noteGeneratedAtMs = now;
        session.lastStep = 'review';
    }
    if (phase === 'finished') {
        session.finishedAtMs = now;
    }
    return session;
}

export function markStep(session, questionIndex) {
    if (!session) return session;
    session.lastStep = `q${questionIndex + 1}`;
    return session;
}

export function recordingStarted(session, questionIndex, now = nowMs()) {
    if (!session) return session;
    markStep(session, questionIndex);
    session.phase = 'capturing';
    session.recordingStartedAtMs = now;
    if (session.firstRecordAtMs === null) session.firstRecordAtMs = now;
    return session;
}

/**
 * The recording stopped; transcription is now in flight. Split from
 * `transcriptReceived` so capture time and provider latency stay separate —
 * a tutor talking for ninety seconds and OpenAI taking nine are different
 * findings, and only the second is a reason to change anything.
 */
export function recordingStopped(session, questionIndex, now = nowMs()) {
    if (!session) return session;
    const step = stepFor(session, questionIndex);
    if (session.recordingStartedAtMs !== null) {
        step.recordMs = boundedDuration(now - session.recordingStartedAtMs);
    }
    session.recordingStartedAtMs = null;
    session.transcribeStartedAtMs = now;
    return session;
}

export function transcriptReceived(session, questionIndex, text = '', now = nowMs()) {
    if (!session) return session;
    const step = stepFor(session, questionIndex);
    if (session.transcribeStartedAtMs !== null) {
        step.transcribeMs = boundedDuration(now - session.transcribeStartedAtMs);
    }
    session.transcribeStartedAtMs = null;
    // Length only. The transcript itself never leaves the browser.
    step.chars = `${text || ''}`.length;
    return session;
}

export function recordAsrError(session, questionIndex) {
    if (!session) return session;
    session.asrErrorCount += 1;
    stepFor(session, questionIndex).errors += 1;
    session.recordingStartedAtMs = null;
    session.transcribeStartedAtMs = null;
    return session;
}

/**
 * The tutor went back to redo an answer.
 *
 * Counted apart from `asrErrorCount` on purpose. A re-record is a tutor
 * choosing to say it better; an ASR error is the tool failing. One number for
 * both would report the most careful tutor in the school as the one having the
 * most trouble.
 */
export function recordReRecord(session, questionIndex) {
    if (!session) return session;
    session.reRecordCount += 1;
    stepFor(session, questionIndex).reRecorded += 1;
    return session;
}

export function recordSkip(session, questionIndex) {
    if (!session) return session;
    stepFor(session, questionIndex).skipped = true;
    return session;
}

/**
 * How far the tutor moved the generated note before saving.
 *
 * Compares the assembled text with what is in the editor at save time. The
 * strongest quality signal available without asking anyone anything — but it
 * measures dissatisfaction, not accuracy: a tutor may edit a perfectly accurate
 * note to add something the three questions never asked about.
 *
 * Only the sizes travel. Whitespace-only differences do not count as an edit,
 * because contenteditable produces them without anyone typing.
 */
export function measureEdit(session, { generated = '', final = '' } = {}) {
    if (!session) return session;
    const normalise = (text) => `${text || ''}`.replace(/\s+/gu, ' ').trim();
    const before = normalise(generated);
    const after = normalise(final);
    session.noteEdited = before !== after;
    session.editCharDelta = after.length - before.length;
    return session;
}

export function recordSafety(session, { flags = 0, acknowledged = false } = {}) {
    if (!session) return session;
    if (flags) session.safetyFlagCount = flags;
    if (acknowledged) session.safetyAck = true;
    return session;
}

export function recordSongs(session, { songIds = [], unlistedTitles = [] } = {}) {
    if (!session) return session;
    session.songsSelected = songIds.length;
    session.unlistedSongs = unlistedTitles.length;
    return session;
}

export function recordRating(session, { accuracy = '', comment = '', now = nowMs() } = {}) {
    if (!session) return session;
    session.ratingAnsweredAt = new Date(now).toISOString();
    // A skip leaves the score blank but stamps the time, so the response rate
    // stays measurable. A prompt people decline is a finding about the prompt.
    session.ratingAccuracy = Number.isInteger(accuracy) && accuracy >= 1 && accuracy <= 5 ? accuracy : '';
    session.ratingComment = `${comment || ''}`.trim().slice(0, MAX_COMMENT);
    return session;
}

/**
 * Whether to show the rating card for this session.
 *
 * Deterministic on the session id, not random: a re-render must not re-roll and
 * pop a card at a tutor who just dismissed one. The roster lives on the server
 * — this app only ever receives a yes/no and a rate.
 *
 * `lastPromptedOn` is the caller's stored date string, so a tutor sees at most
 * one prompt a day however many lessons they teach.
 */
export function shouldPromptForRating({
    session = null,
    evalPrompt = false,
    evalSample = 1,
    lastPromptedOn = '',
    today = new Date().toISOString().slice(0, 10),
} = {}) {
    if (!session || !evalPrompt) return false;
    if (lastPromptedOn === today) return false;
    const sample = Number.isInteger(evalSample) && evalSample >= 1 ? evalSample : 1;
    if (sample === 1) return true;

    let hash = 0;
    for (let index = 0; index < session.sessionId.length; index += 1) {
        hash = ((hash << 5) - hash + session.sessionId.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % sample === 0;
}

/**
 * Whether a closing page still owes the server something.
 *
 * The obvious rule — "flush unless the ritual finished" — is wrong, and was
 * wrong in a way that would have biased the results. `finishSession` marks the
 * session finished and then *holds* the send so the tutor's rating can ride on
 * the same row. A tutor who closed the panel without answering would have left
 * a completed lesson recorded at its previous phase, i.e. abandoned at review —
 * and only ever on sampled sessions, so the completion rate would have been
 * dragged down for precisely the sessions carrying the ratings.
 *
 * So the question is not "did it finish" but "is the server behind".
 */
export function shouldFlushOnHide({ sentPhase = '', phase = '' } = {}) {
    return sentPhase !== phase;
}

/**
 * The wire payload.
 *
 * Built from an explicit field list rather than by spreading the session, so a
 * field added to the in-memory object for the app's own convenience can never
 * accidentally start being transmitted.
 */
export function buildSessionPayload(session) {
    if (!session) return null;

    const captureTotal = session.steps.reduce(
        (sum, step) => sum + (Number.isFinite(step.recordMs) ? step.recordMs : 0), 0,
    );
    const transcribeTotal = session.steps.reduce(
        (sum, step) => sum + (Number.isFinite(step.transcribeMs) ? step.transcribeMs : 0), 0,
    );
    const answered = session.steps.filter((step) => !step.skipped && Number.isFinite(step.chars) && step.chars > 0).length;
    const skipped = session.steps.filter((step) => step.skipped).length;

    // The friction number: first recording to finished. Deliberately not
    // opened-to-finished, which measures a panel left open through a lesson.
    const endMs = session.finishedAtMs ?? session.noteGeneratedAtMs;
    const activeMs = session.firstRecordAtMs !== null && endMs !== null
        ? boundedDuration(endMs - session.firstRecordAtMs)
        : null;

    return {
        sessionId: session.sessionId,
        openedAt: session.openedAt,
        studentId: session.studentId,
        tutor: session.tutor,
        asrModel: session.asrModel,
        buildVersion: session.buildVersion,
        phase: session.phase,
        outcome: session.outcome,
        noteId: session.noteId,
        questionsAnswered: answered,
        questionsSkipped: skipped,
        typedNotSpoken: session.typedNotSpoken,
        lastStep: session.lastStep,
        msToFirstRecord: session.firstRecordAtMs !== null
            ? boundedDuration(session.firstRecordAtMs - session.openedAtMs)
            : '',
        msCaptureTotal: captureTotal || (session.steps.length ? 0 : ''),
        msTranscribeTotal: transcribeTotal || (session.steps.length ? 0 : ''),
        msActive: activeMs ?? '',
        msSessionTotal: endMs !== null ? boundedDuration(endMs - session.openedAtMs) : '',
        asrErrorCount: session.asrErrorCount,
        reRecordCount: session.reRecordCount,
        safetyFlagCount: session.safetyFlagCount,
        safetyAck: session.safetyAck,
        noteEdited: session.noteEdited,
        editCharDelta: session.editCharDelta,
        songsSelected: session.songsSelected,
        unlistedSongs: session.unlistedSongs,
        priorNoteExists: session.priorNoteExists,
        priorNoteAgeDays: Number.isFinite(session.priorNoteAgeDays) ? session.priorNoteAgeDays : '',
        priorHistoryOpened: session.priorHistoryOpened,
        ratingPrompted: session.ratingPrompted,
        ratingAccuracy: session.ratingAccuracy,
        ratingComment: session.ratingComment,
        ratingAnsweredAt: session.ratingAnsweredAt,
        steps: session.steps.map((step) => ({
            q: step.q,
            recordMs: step.recordMs ?? '',
            transcribeMs: step.transcribeMs ?? '',
            chars: step.chars ?? '',
            errors: step.errors,
            skipped: step.skipped,
            reRecorded: step.reRecorded,
        })),
    };
}
