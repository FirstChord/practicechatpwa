// Practice Chat - unsaved note drafts
//
// A tutor who closes the panel before saving used to lose the note: the only
// copy was one localStorage slot that nothing ever read back. A draft is now
// kept per student, on this device only, and offered again the next time the
// panel opens for that same student.
//
// Keyed by student so one child's note can never reappear in another child's
// panel. It holds the answers so far as well as the assembled note, because a
// panel closed between questions loses as much as one closed at review.
//
// Never leaves the browser, like the transcript itself. Cleared once the note
// has gone anywhere (sent, saved or copied), when the tutor starts again, and
// after a day: a draft older than that belongs to last week's lesson.

const DRAFT_PREFIX = 'practiceChatDraft:';
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The one slot the previous build wrote and never read.
const LEGACY_KEYS = ['lastNotes', 'lastNotesTimestamp'];

export function draftKey(studentId = '') {
    return `${DRAFT_PREFIX}${studentId || 'none'}`;
}

function hasContent({ answers = [], note = '' } = {}) {
    return Boolean(`${note}`.trim()) || answers.some((answer) => `${answer || ''}`.trim());
}

/** Save the draft, or remove it when there is nothing in it worth keeping. */
export function writeDraft(storage, studentId, { answers = [], questionIndex = 0, note = '', generatedNote = '' } = {}, now = Date.now()) {
    try {
        const key = draftKey(studentId);
        if (!hasContent({ answers, note })) {
            storage.removeItem(key);
            return false;
        }
        storage.setItem(key, JSON.stringify({
            v: 1,
            savedAt: now,
            answers: [0, 1, 2].map((i) => `${answers[i] || ''}`),
            questionIndex: Math.min(Math.max(Number(questionIndex) || 0, 0), 2),
            note: `${note || ''}`,
            generatedNote: `${generatedNote || ''}`
        }));
        return true;
    } catch {
        // Storage full or blocked. A lost draft is the old behaviour, not a
        // reason to interrupt a lesson.
        return false;
    }
}

/** The draft for this student, or null. An expired or unreadable one is removed. */
export function readDraft(storage, studentId, now = Date.now()) {
    try {
        const key = draftKey(studentId);
        const raw = storage.getItem(key);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        const age = now - Number(draft?.savedAt);
        if (draft?.v !== 1 || !(age >= 0 && age < DRAFT_MAX_AGE_MS) || !hasContent(draft)) {
            storage.removeItem(key);
            return null;
        }
        return draft;
    } catch {
        return null;
    }
}

export function clearDraft(storage, studentId) {
    try {
        storage.removeItem(draftKey(studentId));
    } catch {
        // Nothing to do.
    }
}

/** Drop every other student's expired draft, and the legacy slot. */
export function pruneDrafts(storage, now = Date.now()) {
    try {
        LEGACY_KEYS.forEach((key) => storage.removeItem(key));
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => readDraft(storage, key.slice(DRAFT_PREFIX.length), now));
    } catch {
        // Nothing to do.
    }
}
