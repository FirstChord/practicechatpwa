import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DRAFT_MAX_AGE_MS,
    clearDraft,
    draftKey,
    pruneDrafts,
    readDraft,
    writeDraft
} from '../public/src/note-draft.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        get length() { return data.size; },
        key: (i) => [...data.keys()][i] ?? null,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, `${value}`),
        removeItem: (key) => data.delete(key),
        data
    };
}

const NOW = 1_800_000_000_000;

test('a draft is kept per student and read back', () => {
    const storage = memoryStorage();
    writeDraft(storage, 'sdt_A', { answers: ['Scales.', '', ''], questionIndex: 1 }, NOW);
    const draft = readDraft(storage, 'sdt_A', NOW + 1000);
    assert.deepEqual(draft.answers, ['Scales.', '', '']);
    assert.equal(draft.questionIndex, 1);
    assert.equal(draft.note, '');
});

test('one student never sees another student\'s draft', () => {
    const storage = memoryStorage();
    writeDraft(storage, 'sdt_A', { note: '[What we did]\nScales.' }, NOW);
    assert.equal(readDraft(storage, 'sdt_B', NOW), null);
    assert.ok(readDraft(storage, 'sdt_A', NOW));
});

test('an empty draft removes the saved one instead of storing nothing', () => {
    const storage = memoryStorage();
    writeDraft(storage, 'sdt_A', { answers: ['Scales.'] }, NOW);
    assert.equal(writeDraft(storage, 'sdt_A', { answers: ['', '  ', ''] }, NOW), false);
    assert.equal(storage.getItem(draftKey('sdt_A')), null);
});

test('a draft older than a day is dropped, not restored', () => {
    const storage = memoryStorage();
    writeDraft(storage, 'sdt_A', { note: 'Old.' }, NOW);
    assert.equal(readDraft(storage, 'sdt_A', NOW + DRAFT_MAX_AGE_MS), null);
    assert.equal(storage.getItem(draftKey('sdt_A')), null);
});

test('clearing and unreadable values are harmless', () => {
    const storage = memoryStorage({ [draftKey('sdt_A')]: '{not json' });
    assert.equal(readDraft(storage, 'sdt_A', NOW), null);
    clearDraft(storage, 'sdt_A');
    assert.equal(storage.getItem(draftKey('sdt_A')), null);
    // Blocked storage must never throw into a lesson.
    assert.equal(writeDraft(null, 'sdt_A', { note: 'x' }, NOW), false);
    assert.equal(readDraft(null, 'sdt_A', NOW), null);
    clearDraft(null, 'sdt_A');
    pruneDrafts(null, NOW);
});

test('pruning drops expired drafts and the legacy slot, and keeps fresh ones', () => {
    const storage = memoryStorage({ lastNotes: 'old', lastNotesTimestamp: '1', unrelated: 'keep' });
    writeDraft(storage, 'sdt_old', { note: 'Old.' }, NOW - DRAFT_MAX_AGE_MS - 1);
    writeDraft(storage, 'sdt_new', { note: 'New.' }, NOW);
    pruneDrafts(storage, NOW);
    assert.deepEqual([...storage.data.keys()].sort(), [draftKey('sdt_new'), 'unrelated'].sort());
});
