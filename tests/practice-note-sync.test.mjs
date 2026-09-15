import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPracticeNoteId,
  buildPracticeNoteSnapshot,
  executePracticeNoteGroup,
  executePracticeNoteMmsTestWrite,
  fetchPracticeChatMusicContext,
  getPracticeChatContext,
  isLocalMmsWriteTestAvailable,
  previewPracticeNoteGroup,
  previewPracticeNoteMmsTestWrite,
  savePracticeChatSession,
  savePracticeNoteSnapshot,
  splitStructuredNoteText,
  suggestPracticeNoteSongs
} from '../public/src/practice-note-sync.js';

test('getPracticeChatContext reads dashboard handoff query params', () => {
  const context = getPracticeChatContext('?studentId=sdt_123&studentName=Ada%20Lovelace&tutor=Dean&dashboardBaseUrl=https%3A%2F%2Fexample.com%2F&practiceChatSecret=secret-token');

  assert.deepEqual(context, {
    studentId: 'sdt_123',
    studentName: 'Ada Lovelace',
    tutor: 'Dean',
    practiceChatSecret: 'secret-token',
    dashboardBaseUrl: 'https://example.com',
    // Evaluation context, absent unless the dashboard sends it.
    evalPrompt: false,
    evalSample: 1,
    priorNoteExists: false,
    priorNoteAgeDays: undefined,
    priorHistoryOpened: false,
  });
});

test('getPracticeChatContext reads the evaluation params', () => {
  const context = getPracticeChatContext(
    '?studentId=sdt_1&tutor=Finn&evalPrompt=1&evalSample=4&priorNoteExists=1&priorNoteAgeDays=7&priorHistoryOpened=1'
  );

  assert.equal(context.evalPrompt, true);
  assert.equal(context.evalSample, 4);
  assert.equal(context.priorNoteExists, true);
  assert.equal(context.priorNoteAgeDays, 7);
  assert.equal(context.priorHistoryOpened, true);
});

test('the evaluation params fail closed on anything unexpected', () => {
  // A prompt shown because a stray query param looked truthy would be an
  // interruption nobody agreed to.
  for (const search of ['?evalPrompt=true', '?evalPrompt=yes', '?evalPrompt=0', '?evalPrompt']) {
    assert.equal(getPracticeChatContext(search).evalPrompt, false, search);
  }
  // A bad sample rate becomes 1 rather than silencing the prompt entirely: a
  // prompt nobody ever sees is worse than no prompt, because it looks configured.
  for (const search of ['?evalSample=0', '?evalSample=-2', '?evalSample=weekly', '?evalSample=']) {
    assert.equal(getPracticeChatContext(search).evalSample, 1, search);
  }
});

test('the launch URL never carries the evaluation roster', () => {
  // The server decides who is enabled. If a tutor list ever reached this app it
  // would be publishing who is in the trial, in a URL, in a public PWA.
  const context = getPracticeChatContext('?studentId=sdt_1&tutor=Finn&evalPrompt=1&evalSample=4');
  const serialised = JSON.stringify(context);
  assert.equal(serialised.includes('Dean'), false);
  assert.equal(Object.keys(context).some((key) => /tutors|roster|allow/i.test(key)), false);
});

test('savePracticeChatSession stays silent when it cannot send', async () => {
  // Measurement must never interrupt, delay or fail a lesson.
  const failing = () => Promise.reject(new Error('offline'));
  const result = await savePracticeChatSession({
    dashboardBaseUrl: 'https://example.com',
    payload: { sessionId: 'pcs_1', studentId: 'sdt_1' },
    fetchImpl: failing,
  });
  assert.deepEqual(result, { ok: false, skipped: true });
});

test('savePracticeChatSession does nothing without dashboard context', async () => {
  let called = false;
  const spy = () => { called = true; return Promise.resolve({ ok: true, status: 200 }); };

  for (const payload of [null, { sessionId: '', studentId: 'sdt_1' }, { sessionId: 'pcs_1', studentId: '' }]) {
    const result = await savePracticeChatSession({
      dashboardBaseUrl: 'https://example.com',
      payload,
      fetchImpl: spy,
    });
    assert.deepEqual(result, { skipped: true });
  }

  const noDashboard = await savePracticeChatSession({
    dashboardBaseUrl: '',
    payload: { sessionId: 'pcs_1', studentId: 'sdt_1' },
    fetchImpl: spy,
  });
  assert.deepEqual(noDashboard, { skipped: true });
  assert.equal(called, false, 'a bookmarked PWA with no dashboard context records nothing');
});

test('savePracticeChatSession posts the payload with the shared secret', async () => {
  let seen = null;
  const spy = (url, options) => {
    seen = { url, options };
    return Promise.resolve({ ok: true, status: 200 });
  };

  await savePracticeChatSession({
    dashboardBaseUrl: 'https://example.com',
    payload: { sessionId: 'pcs_1', studentId: 'sdt_1', phase: 'finished' },
    practiceChatSecret: 'secret-token',
    keepalive: true,
    fetchImpl: spy,
  });

  assert.equal(seen.url, 'https://example.com/api/practice-chat-sessions');
  assert.equal(seen.options.headers['X-FirstChord-PracticeChat-Secret'], 'secret-token');
  assert.equal(seen.options.keepalive, true, 'the final write must survive the panel closing');
  assert.equal(JSON.parse(seen.options.body).phase, 'finished');
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

test('the group route asks the server, and never decides households itself', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ isGroup: true, summary: 'Athena and Sophia will be marked present.' }) };
    };

    const preview = await previewPracticeNoteGroup({
        dashboardBaseUrl: 'https://dash.example',
        studentId: 'sdt_M3RnJG',
        noteText: 'Worked on scales.',
        targetAttendanceId: 'atn_a',
        tutor: 'Matthew',
        practiceChatSecret: 'shh',
        fetchImpl
    });

    assert.equal(preview.isGroup, true);
    assert.equal(calls[0].url, 'https://dash.example/api/practice-notes/group');
    assert.equal(calls[0].body.mode, 'dry_run');
    // A dry run must never carry the execute confirmation.
    assert.equal(calls[0].body.confirmGroupDelivery, false);
    assert.equal(calls[0].body.studentMmsId, 'sdt_M3RnJG');
    // No recipient or household field is sent: the server owns that decision,
    // because getting it wrong means a duplicate email to a parent.
    assert.equal('recipients' in calls[0].body, false);
    assert.equal('confirmedRecipientEmail' in calls[0].body, false);
});

test('executing a group delivery sets the explicit group confirmation', async () => {
    let sent = null;
    const fetchImpl = async (url, init) => {
        sent = JSON.parse(init.body);
        return { ok: true, json: async () => ({ status: 'completed' }) };
    };

    await executePracticeNoteGroup({
        dashboardBaseUrl: 'https://dash.example',
        studentId: 'sdt_M3RnJG',
        noteText: 'Worked on scales.',
        targetAttendanceId: 'atn_a',
        fetchImpl
    });

    assert.equal(sent.mode, 'execute');
    assert.equal(sent.confirmGroupDelivery, true);
});

test('a failing group route surfaces the server message', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Tutor not enabled' }) });
    await assert.rejects(
        () => previewPracticeNoteGroup({ dashboardBaseUrl: 'https://dash.example', studentId: 'sdt_1', fetchImpl }),
        /Tutor not enabled/u
    );
});
