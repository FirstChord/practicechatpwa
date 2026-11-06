// Browser tests: what the screens do, not just the helpers underneath.
// Each test pins a behaviour that was checked by hand during the October 2026
// refresh and would otherwise only be noticed by a tutor mid-lesson.
//
//   npm run test:browser
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { answer, buttonTop, closeBrowser, completeQuestions, openApp, startServer } from './harness.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); server.close(); });

const visible = (page, selector) => page.locator(selector).isVisible();
const savedNote = (page) => page.evaluate(async () => {
    const markup = await import('/src/note-markup.js');
    return markup.serialiseNoteMarkup(document.getElementById('processed'));
});

for (const width of [768, 390]) {
    test(`the record button stays put across all three questions (${width}px)`, async () => {
        // Q2 is two lines plus a follow-up and Q1 one line, so without the
        // shared question space the button moved under the cursor after Next.
        const { page, errors, close } = await openApp(server, { width, autoAnswer: 'An answer.' });
        const tops = [await buttonTop(page)];
        for (let i = 0; i < 2; i++) {
            await answer(page, 'An answer.');
            await page.click('#mainActionBtn');
            tops.push(await buttonTop(page));
        }
        assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, `button moved: ${tops.join(', ')}`);
        assert.deepEqual(errors, []);
        await close();
    });
}

test('a full lesson reaches "Lesson done" with the parent confirmed and no page errors', async () => {
    const { page, calls, errors, close } = await openApp(server, { autoAnswer: null });
    await completeQuestions(page);
    await page.click('#mmsDateConfirm');
    await page.click('#mmsExecuteBtn');
    await page.click('#sendRecipientConfirm');
    await page.click('.action-confirm-primary');
    await page.waitForFunction(() => document.getElementById('mmsExecuteBtn').textContent.includes('Lesson done'));
    const execute = calls.find((call) => call.key === 'mms-test' && call.mode === 'execute');
    assert.equal(execute.attendanceStatus, 'Present');
    assert.equal(execute.confirmRecipient, true);
    assert.equal(execute.confirmedRecipientEmail, 'parent@example.com');
    assert.deepEqual(errors, []);
    await close();
});

test('section labels are styled in the editor but the note saves exactly as written', async () => {
    const answers = ['We worked on scales and Let It Be.', 'The chorus went well.', 'Slow F to C changes after school.'];
    const { page, close } = await openApp(server);
    await completeQuestions(page, answers);
    assert.equal(await page.locator('#processed .note-label').count(), 3);
    assert.equal(
        await savedNote(page),
        `[What we did]\n${answers[0]}\n\n[Progress & Challenges]\n${answers[1]}\n\n[Practice Goals]\n${answers[2]}`
    );
    await close();
});

test('editing right next to a styled label never adds bold or italic markers', async () => {
    // contenteditable can copy computed styles inline when lines merge; a bold
    // label would then leak ** into the parent's email.
    const { page, close } = await openApp(server);
    await completeQuestions(page, ['Scales.', 'Good.', 'Slowly.']);
    const caretAt = (text, offset = 0) => page.evaluate(([t, o]) => {
        const walker = document.createTreeWalker(document.getElementById('processed'), NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const index = node.data.indexOf(t);
            if (index < 0) continue;
            const range = document.createRange();
            range.setStart(node, index + o);
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            return;
        }
        throw new Error(`not found: ${t}`);
    }, [text, offset]);
    await page.click('#processed');
    await caretAt('Scales.'); await page.keyboard.press('Backspace'); await page.keyboard.type(' merged');
    await caretAt('[Practice', 4); await page.keyboard.press('Enter'); await page.keyboard.type('split');
    await caretAt('Good.', 5); await page.keyboard.press('Delete');
    const note = await savedNote(page);
    assert.doesNotMatch(note, /\*\*|(^|\s)_\S/);
    assert.equal(await page.locator('#processed [style]').count(), 0);
    await close();
});

test('the transcribing line shows while waiting and clears on an answer, a failure and silence', async () => {
    const { page, close } = await openApp(server);
    const line = () => page.evaluate(() => {
        const el = document.getElementById('processingMessage');
        return el.hidden ? '' : el.textContent;
    });
    const recordAndHold = async () => {
        await page.click('#mainActionBtn');
        await page.waitForFunction(() => document.getElementById('mainActionText').textContent === 'Listening…');
        await page.click('#mainActionBtn');
        await page.waitForFunction(() => window.__asr.pending);
    };

    await recordAndHold();
    assert.equal(await line(), 'Tuning up the transcript…');
    await page.evaluate(() => window.__asr.release('An answer.'));
    await page.waitForFunction(() => document.getElementById('currentAnswer').style.display !== 'none');
    assert.equal(await line(), '');

    await page.click('#mainActionBtn');          // Next
    await recordAndHold();
    await page.evaluate(() => window.__asr.release(new Error('test failure')));
    await page.waitForFunction(() => document.getElementById('status').style.display !== 'none');
    assert.equal(await line(), '');

    await recordAndHold();
    await page.evaluate(() => window.__asr.release(''));
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('No answer'));
    assert.equal(await line(), '');
    await close();
});

test('the absence link appears only on the first question, and only from the dashboard', async () => {
    const bookmark = await openApp(server, { dashboard: false });
    assert.equal(await visible(bookmark.page, '#absentBtn'), false);
    await bookmark.close();

    const { page, close } = await openApp(server, { autoAnswer: 'An answer.' });
    assert.equal(await visible(page, '#absentBtn'), true);
    await answer(page, 'An answer.');
    await page.click('#mainActionBtn');
    assert.equal(await visible(page, '#absentBtn'), false);
    await close();
});

test('the absence shortcut marks one student absent, with no note and no group lookup', async () => {
    // The fake dashboard says this is a shared lesson. One absent child must
    // never mark the whole lesson absent, so the group is never even asked.
    const sharedLesson = (key, body) => (key === 'group'
        ? { isGroup: true, group: { plan: [{ studentName: 'Test Student', isLead: true }, { studentName: 'Other Student' }] } }
        : key === 'mms-test' && body.mode === 'execute'
            ? { targetAttendance: { attendanceId: 'att_test_1', eventStartDate: new Date().toISOString() }, requestedAttendanceStatus: 'AbsentNoMakeup', practiceNoteLog: { ok: true }, emailNotes: { ok: true } }
            : key === 'mms-test'
                ? { targetAttendance: { attendanceId: 'att_test_1', eventStartDate: new Date().toISOString(), attendanceStatus: 'Unrecorded' }, candidateAttendances: [], recipients: [] }
                : { ok: true });
    const { page, calls, errors, close } = await openApp(server, { api: sharedLesson });
    await page.click('#absentBtn');
    assert.equal(await visible(page, '#processed'), false);
    assert.equal(await visible(page, '#songLinkPanel'), false);
    assert.equal(await page.locator('#mmsExecuteBtn').isDisabled(), true);
    await page.click('#mmsDateConfirm');
    await page.click('#mmsExecuteBtn');
    await page.click('.action-confirm-primary');
    await page.waitForFunction(() => document.getElementById('mmsExecuteBtn').textContent.includes('Absent marked'));

    const mms = calls.filter((call) => call.key === 'mms-test');
    assert.deepEqual(mms.map((call) => [call.mode, call.attendanceStatus, call.noteText]), [
        ['dry_run', 'AbsentNoMakeup', ''],
        ['execute', 'AbsentNoMakeup', ''],
    ]);
    assert.equal(calls.some((call) => call.key === 'group'), false, 'shared-lesson group was looked up');
    assert.equal(await visible(page, '#absenceBackBtn'), false, 'Back still offered after saving');
    assert.deepEqual(errors, []);
    await close();
});

test('Back from the absence screen leads to an ordinary lesson', async () => {
    const { page, close } = await openApp(server);
    await page.click('#absentBtn');
    await page.click('#absenceBackBtn');
    await completeQuestions(page);
    assert.equal(await visible(page, '.attendance-choice'), true);
    assert.equal(await page.locator('input[value="Present"]').isChecked(), true);
    assert.match(await page.locator('#mmsExecuteBtn').innerText(), /email parent/);
    await close();
});

test('the send check uses the safeguarding prompt for a disclosure and the wording prompt otherwise', async () => {
    const { page, close } = await openApp(server);
    await page.click('#typeNotesBtn');
    const tryToSend = async (text) => {
        await page.evaluate((t) => { document.getElementById('processed').textContent = `[What we did]\n${t}`; }, text);
        if (!(await page.locator('#mmsDateConfirm').isChecked())) await page.click('#mmsDateConfirm');
        await page.click('#mmsExecuteBtn');
        const title = await page.locator('#safetyConfirmTitle').innerText();
        await page.click('[data-confirm="cancel"]');
        return title;
    };
    assert.equal(await tryToSend('She said she is being bullied at school.'), 'This note may mention something personal');
    assert.equal(await tryToSend('Those scales sounded really sexy.'), 'One word may have been misheard');
    await close();
});

test('another element with class "step" on the page does not break the questions', async () => {
    // The demo overlay's caption badge used that class; an unscoped query hit
    // it and aborted the question update before the button changed.
    const { page, errors, close } = await openApp(server, { autoAnswer: 'An answer.' });
    await page.evaluate(() => {
        const stray = document.createElement('span');
        stray.className = 'step';
        document.body.appendChild(stray);
    });
    await answer(page, 'An answer.');
    await page.click('#mainActionBtn');
    assert.match(await page.locator('.question-block.is-current').innerText(), /What went well/);
    assert.equal(await page.locator('#mainActionText').innerText(), 'Start recording');
    assert.deepEqual(errors, []);
    await close();
});

// The panel closing before the note is saved used to lose it for good.
const reopen = async (page) => {
    // Module scripts run before `load`, which reload() waits for. The record
    // button is hidden when the review screen comes back, so it is no signal.
    await page.reload();
};

test('closing the panel mid-questions keeps the answers for next time', async () => {
    const { page, errors, close } = await openApp(server);
    await answer(page, 'We worked on scales.');
    await page.click('#mainActionBtn');
    await answer(page, 'The chorus went well.');
    await reopen(page);
    assert.match(await page.locator('.question-block.is-current').innerText(), /What went well/);
    assert.equal(await page.locator('#currentAnswer').innerText(), 'The chorus went well.');
    assert.match(await page.locator('#status').innerText(), /Unsaved note from .* restored/);
    assert.deepEqual(errors, []);
    await close();
});

test('an edited note on the review screen comes back exactly as left, until New', async () => {
    const { page, errors, close } = await openApp(server);
    await completeQuestions(page, ['Scales.', 'Good.', 'Slowly.']);
    await page.click('#processed');
    await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('processed'));
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    });
    await page.keyboard.type(' Every day.');
    const edited = await savedNote(page);
    assert.match(edited, /Every day\.$/);

    await reopen(page);
    assert.ok(await visible(page, '#processed'));
    assert.equal(await savedNote(page), edited);

    await page.click('#newBtn');
    await reopen(page);
    assert.equal(await visible(page, '#processed'), false);
    assert.equal(await page.locator('#currentAnswer').isVisible(), false);
    assert.deepEqual(errors, []);
    await close();
});

test('a sent note is not offered again, and a draft never crosses to another student', async () => {
    const { page, close } = await openApp(server);
    await completeQuestions(page);
    // Another student's panel on the same device: nothing restored.
    const url = new URL(page.url());
    url.searchParams.set('studentId', 'sdt_TEST02');
    await page.goto(url.toString());
    await page.locator('#mainActionBtn').waitFor();
    assert.equal(await visible(page, '#processed'), false);

    // Back to the first student: restored, then sent, then gone.
    url.searchParams.set('studentId', 'sdt_TEST01');
    await page.goto(url.toString());
    await page.locator('#processed').waitFor({ state: 'visible' });
    await page.click('#mmsDateConfirm');
    await page.click('#mmsExecuteBtn');
    await page.click('#sendRecipientConfirm');
    await page.click('.action-confirm-primary');
    await page.waitForFunction(() => document.getElementById('mmsExecuteBtn').textContent.includes('Lesson done'));
    await reopen(page);
    assert.equal(await visible(page, '#processed'), false);
    await close();
});

test('Tidy shows only when the dashboard offers it, replaces the note, and Undo puts it back', async () => {
    const hidden = await openApp(server);
    await completeQuestions(hidden.page, ['Scales.', 'Good.', 'Slowly.']);
    assert.equal(await visible(hidden.page, '#tidyNoteBtn'), false);
    await hidden.close();

    const api = (key, body) => {
        if (key === 'music-context') return { songs: [], catalogueSongs: [], tidy: true };
        if (key === 'tidy') return { text: body.text.replace('Scales.', 'Scales and arpeggios.'), speakersAdded: true };
        return key === 'group' ? { isGroup: false } : { ok: true };
    };
    const { page, calls, errors, close } = await openApp(server, { api });
    await completeQuestions(page, ['Scales.', 'Good.', 'Slowly.']);
    const original = await savedNote(page);

    await page.click('#tidyNoteBtn');
    await page.locator('#tidyNoteBtn', { hasText: 'Undo tidy' }).waitFor();
    assert.match(await savedNote(page), /Scales and arpeggios\./);
    assert.equal(calls.find((call) => call.key === 'tidy').text, original);
    assert.match(await page.locator('#status').textContent(), /Check who said what/);

    await page.click('#tidyNoteBtn');
    assert.equal(await savedNote(page), original);
    assert.equal(await page.locator('#tidyNoteBtn').textContent(), 'Tidy');

    // Typing after a tidy drops the undo, so it can never erase later edits.
    await page.click('#tidyNoteBtn');
    await page.locator('#tidyNoteBtn', { hasText: 'Undo tidy' }).waitFor();
    await page.click('#processed');
    await page.keyboard.type(' x');
    assert.equal(await page.locator('#tidyNoteBtn').textContent(), 'Tidy');
    assert.deepEqual(errors, []);
    await close();
});

test('a refused tidy leaves the note exactly as it was', async () => {
    const api = (key) => {
        if (key === 'music-context') return { songs: [], catalogueSongs: [], tidy: true };
        if (key === 'tidy') return { error: 'Tidy changed too much, so your note is unchanged.', code: 'failed_checks' };
        return key === 'group' ? { isGroup: false } : { ok: true };
    };
    const { page, errors, close } = await openApp(server, { api });
    await completeQuestions(page, ['Scales.', 'Good.', 'Slowly.']);
    const original = await savedNote(page);
    await page.click('#tidyNoteBtn');
    await page.locator('#status', { hasText: 'changed too much' }).waitFor();
    assert.equal(await savedNote(page), original);
    assert.equal(await page.locator('#tidyNoteBtn').textContent(), 'Tidy');
    assert.deepEqual(errors, []);
    await close();
});
