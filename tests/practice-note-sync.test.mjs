import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPracticeNoteId,
  buildPracticeNoteSnapshot,
  executePracticeNoteMmsTestWrite,
  getPracticeChatContext,
  isLocalMmsWriteTestAvailable,
  previewPracticeNoteMmsTestWrite,
  savePracticeNoteSnapshot,
  splitStructuredNoteText,
} from '../public/src/practice-note-sync.js';

test('getPracticeChatContext reads dashboard handoff query params', () => {
  const context = getPracticeChatContext('?studentId=sdt_123&studentName=Ada%20Lovelace&tutor=Dean&dashboardBaseUrl=https%3A%2F%2Fexample.com%2F&practiceChatSecret=secret-token');

  assert.deepEqual(context, {
    studentId: 'sdt_123',
    studentName: 'Ada Lovelace',
    tutor: 'Dean',
    practiceChatSecret: 'secret-token',
    dashboardBaseUrl: 'https://example.com',
  });
});

test('buildPracticeNoteId is stable for the same student, date, and note text', () => {
  assert.equal(
    buildPracticeNoteId({
      studentId: 'sdt_abc',
      lessonDate: '2026-06-11',
      rawNoteText: 'Lesson note',
    }),
    buildPracticeNoteId({
      studentId: 'sdt_abc',
      lessonDate: '2026-06-11',
      rawNoteText: 'Lesson note',
    }),
  );

  assert.notEqual(
    buildPracticeNoteId({
      studentId: 'sdt_abc',
      lessonDate: '2026-06-11',
      rawNoteText: 'Lesson note',
    }),
    buildPracticeNoteId({
      studentId: 'sdt_abc',
      lessonDate: '2026-06-11',
      rawNoteText: 'Different note',
    }),
  );
});

test('splitStructuredNoteText reads bracketed and colon headings', () => {
  assert.deepEqual(splitStructuredNoteText(`[What we did]
Scales and Starman.

[Progress & Challenges]
Cleaner rhythm.

[Practice Goals]
Slow left hand.`), {
    whatWeDid: 'Scales and Starman.',
    progressChallenges: 'Cleaner rhythm.',
    practiceGoals: 'Slow left hand.',
  });

  assert.deepEqual(splitStructuredNoteText(`What we did:
Warmups.
Progress & Challenges:
Pitch was stronger.
Practice Goals:
Practise chorus.`), {
    whatWeDid: 'Warmups.',
    progressChallenges: 'Pitch was stronger.',
    practiceGoals: 'Practise chorus.',
  });
});

test('buildPracticeNoteSnapshot builds an append-only dashboard payload', () => {
  const snapshot = buildPracticeNoteSnapshot({
    context: {
      studentId: 'sdt_abc',
      studentName: 'Charlie Norton',
      tutor: 'Kenny',
    },
    noteText: `[What we did]
Song work.

[Practice Goals]
Verse twice.`,
    now: new Date('2026-06-11T12:00:00.000Z'),
  });

  assert.equal(snapshot.studentMmsId, 'sdt_abc');
  assert.match(snapshot.noteId, /^practice_note:sdt_abc:2026-06-11:/u);
  assert.equal(snapshot.studentName, 'Charlie Norton');
  assert.equal(snapshot.tutorName, 'Kenny');
  assert.equal(snapshot.lessonDate, '2026-06-11');
  assert.equal(snapshot.whatWeDid, 'Song work.');
  assert.equal(snapshot.practiceGoals, 'Verse twice.');
  assert.equal(snapshot.copiedToClipboard, true);
  assert.equal(snapshot.attendanceStepOpened, true);
});

test('buildPracticeNoteSnapshot skips unlinked notes', () => {
  assert.equal(buildPracticeNoteSnapshot({
    context: {},
    noteText: 'A useful note without a student link',
  }), null);
});

test('savePracticeNoteSnapshot posts to dashboard API and reports failures', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({ success: true, noteId: 'practice_note:sdt_abc:123' }),
    };
  };

  const result = await savePracticeNoteSnapshot({
    dashboardBaseUrl: 'https://dashboard.example',
    snapshot: { studentMmsId: 'sdt_abc', rawNoteText: 'Lesson note', practiceChatSecret: 'secret-token' },
    fetchImpl,
  });

  assert.equal(result.noteId, 'practice_note:sdt_abc:123');
  assert.equal(requests[0].url, 'https://dashboard.example/api/practice-notes');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['X-FirstChord-PracticeChat-Secret'], 'secret-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    studentMmsId: 'sdt_abc',
    rawNoteText: 'Lesson note',
  });

  await assert.rejects(
    savePracticeNoteSnapshot({
      dashboardBaseUrl: 'https://dashboard.example',
      snapshot: { studentMmsId: 'sdt_abc' },
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'note text is required' }),
      }),
    }),
    /note text is required/u,
  );
});

test('isLocalMmsWriteTestAvailable allows Level 2 pilot tutors and Test Studenty', () => {
  assert.equal(isLocalMmsWriteTestAvailable({
    context: {
      studentId: 'sdt_real',
      tutor: 'Finn',
      dashboardBaseUrl: 'http://localhost:3000',
    },
    hostname: 'localhost',
  }), true);

  assert.equal(isLocalMmsWriteTestAvailable({
    context: {
      studentId: 'sdt_real',
      tutor: 'Dean',
      dashboardBaseUrl: 'http://localhost:3000',
    },
    hostname: 'localhost',
  }), false);

  assert.equal(isLocalMmsWriteTestAvailable({
    context: {
      studentId: 'sdt_fBg9JN',
      tutor: 'Dean',
      dashboardBaseUrl: 'https://efficient-sparkle-production.up.railway.app',
    },
    hostname: 'practice-chat-pwa.web.app',
  }), true);
});

test('previewPracticeNoteMmsTestWrite posts a dry-run request', async () => {
  const requests = [];
  const result = await previewPracticeNoteMmsTestWrite({
    dashboardBaseUrl: 'http://localhost:3000',
    studentId: 'sdt_fBg9JN',
    noteText: 'Test note',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ success: true, mode: 'dry_run' }),
      };
    },
  });

  assert.equal(result.mode, 'dry_run');
  assert.equal(requests[0].url, 'http://localhost:3000/api/practice-notes/mms-test');
  assert.equal(JSON.parse(requests[0].options.body).mode, 'dry_run');
});

test('executePracticeNoteMmsTestWrite posts explicit confirmed target', async () => {
  const requests = [];
  await executePracticeNoteMmsTestWrite({
    dashboardBaseUrl: 'http://localhost:3000',
    studentId: 'sdt_fBg9JN',
    noteText: 'Test note',
    targetAttendanceId: 'atn_test',
    noteSnapshot: {
      noteId: 'practice_note:sdt_fBg9JN:2026-06-12:test',
      studentMmsId: 'sdt_fBg9JN',
      rawNoteText: 'Test note',
    },
    practiceChatSecret: 'secret-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ success: true, mode: 'execute' }),
      };
    },
  });

  assert.equal(requests[0].options.headers['X-FirstChord-PracticeChat-Secret'], 'secret-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    studentMmsId: 'sdt_fBg9JN',
    noteText: 'Test note',
    mode: 'execute',
    targetAttendanceId: 'atn_test',
    noteSnapshot: {
      noteId: 'practice_note:sdt_fBg9JN:2026-06-12:test',
      studentMmsId: 'sdt_fBg9JN',
      rawNoteText: 'Test note',
    },
    confirmLevel2Pilot: true,
  });
});
