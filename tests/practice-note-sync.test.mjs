import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPracticeNoteId,
  buildPracticeNoteSnapshot,
  executePracticeNoteMmsTestWrite,
  fetchPracticeChatMusicContext,
  getPracticeChatContext,
  isLocalMmsWriteTestAvailable,
  previewPracticeNoteMmsTestWrite,
  savePracticeNoteSnapshot,
  splitStructuredNoteText,
  suggestPracticeNoteSongs,
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
    songIds: ['fc_song_a', 'fc_song_a', 'fc_song_b'],
    unlistedSongTitles: [' Tutor original ', 'Tutor original'],
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
  assert.deepEqual(snapshot.songIds, ['fc_song_a', 'fc_song_b']);
  assert.deepEqual(snapshot.unlistedSongTitles, ['Tutor original']);
});

test('fetchPracticeChatMusicContext preserves exact song objects for selection', async () => {
  const context = await fetchPracticeChatMusicContext({
    dashboardBaseUrl: 'https://dashboard.example',
    studentId: 'sdt_abc',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        prompt: 'Guitar: Ho Hey',
        instrument: 'Guitar',
        songTitles: ['Ho Hey'],
        songs: [{ songId: 'fc_song_a', title: 'Ho Hey', status: 'working' }],
        catalogueSongs: [
          { songId: 'fc_song_a', title: 'Ho Hey', artist: 'The Lumineers', contentType: 'song' },
          { songId: 'fc_song_b', title: 'Stand By Me', artist: 'Ben E. King', contentType: 'song' },
        ],
      }),
    }),
  });

  assert.deepEqual(context.songs, [{ songId: 'fc_song_a', title: 'Ho Hey', status: 'working' }]);
  assert.equal(context.catalogueSongs.length, 2);
});

test('suggestPracticeNoteSongs prioritises exact current-shelf mentions', () => {
  const suggestions = suggestPracticeNoteSongs({
    noteText: `[What we did]\nWe worked on Ho Hey and Stand By Me.\n\n[Practice Goals]\nPerfect chord changes.`,
    shelfSongs: [{ songId: 'fc_song_a', title: 'Ho Hey', status: 'working' }],
    catalogueSongs: [
      { songId: 'fc_song_a', title: 'Ho Hey', artist: 'The Lumineers' },
      { songId: 'fc_song_b', title: 'Stand By Me', artist: 'Ben E. King' },
      { songId: 'fc_song_c', title: 'Perfect', artist: 'Ed Sheeran' },
    ],
  });

  assert.deepEqual(suggestions.map(({ songId, suggestionSource }) => ({ songId, suggestionSource })), [
    { songId: 'fc_song_a', suggestionSource: 'current_shelf_exact' },
    { songId: 'fc_song_b', suggestionSource: 'catalogue_exact' },
  ]);
});

test('suggestPracticeNoteSongs requires a music-work cue for ambiguous one-word titles', () => {
  const catalogueSongs = [{ songId: 'fc_song_perfect', title: 'Perfect', artist: 'Ed Sheeran' }];
  assert.deepEqual(suggestPracticeNoteSongs({
    noteText: '[What we did]\nThe chord change was perfect today.',
    catalogueSongs,
  }), []);
  assert.deepEqual(suggestPracticeNoteSongs({
    noteText: '[What we did]\nWe worked on Perfect today.',
    catalogueSongs,
  }).map((song) => song.songId), ['fc_song_perfect']);
});

test('suggestPracticeNoteSongs suppresses duplicate catalogue titles unless the shelf resolves them', () => {
  const catalogueSongs = [
    { songId: 'fc_song_a', title: 'New World Symphony', artist: 'Course A' },
    { songId: 'fc_song_b', title: 'New World Symphony', artist: 'Course B' },
  ];
  const noteText = '[What we did]\nNew World Symphony.';
  assert.deepEqual(suggestPracticeNoteSongs({ noteText, catalogueSongs }), []);
  assert.deepEqual(suggestPracticeNoteSongs({
    noteText,
    catalogueSongs,
    shelfSongs: [{ songId: 'fc_song_b', title: 'New World Symphony', status: 'working' }],
  }).map((song) => song.songId), ['fc_song_b']);
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

test('isLocalMmsWriteTestAvailable lets the server enforce the tutor rollout', () => {
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
      tutor: 'Kenny',
      dashboardBaseUrl: 'http://localhost:3000',
    },
    hostname: 'localhost',
  }), true);

  assert.equal(isLocalMmsWriteTestAvailable({
    context: {
      studentId: 'sdt_real',
      tutor: 'Dean Louden',
      dashboardBaseUrl: 'http://localhost:3000',
    },
    hostname: 'localhost',
  }), true);

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
    songIds: ['fc_song_a'],
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
  assert.deepEqual(JSON.parse(requests[0].options.body).songIds, ['fc_song_a']);
});

test('executePracticeNoteMmsTestWrite posts explicit confirmed target', async () => {
  const requests = [];
  await executePracticeNoteMmsTestWrite({
    dashboardBaseUrl: 'http://localhost:3000',
    studentId: 'sdt_fBg9JN',
    noteText: 'Test note',
    targetAttendanceId: 'atn_test',
    attendanceStatus: 'AbsentNoMakeup',
    songIds: ['fc_song_a'],
    unlistedSongTitles: ['Tutor original'],
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
    attendanceStatus: 'AbsentNoMakeup',
    songIds: ['fc_song_a'],
    unlistedSongTitles: ['Tutor original'],
    noteSnapshot: {
      noteId: 'practice_note:sdt_fBg9JN:2026-06-12:test',
      studentMmsId: 'sdt_fBg9JN',
      rawNoteText: 'Test note',
    },
    confirmLevel2Pilot: true,
    confirmRecipient: false,
    confirmedRecipientEmail: '',
  });
});
