import test from 'node:test';
import assert from 'node:assert/strict';

import {
    noteMarkupToHtml,
    rawNoteText,
    renderNoteMarkup,
    serialiseNoteMarkup,
    stripNoteMarkers,
    toggleBulletLines
} from '../public/src/note-markup.js';

// A minimal stand-in for the editor DOM. serialiseNoteMarkup only ever reads
// nodeType, tagName, childNodes, data and style, so a plain object tree
// exercises the real walk without a browser.
const text = (data) => ({ nodeType: 3, data });
const el = (tagName, children = [], style = {}) => ({
    nodeType: 1,
    tagName,
    style,
    childNodes: children
});
const root = (children) => el('DIV', children);

test('plain text survives untouched', () => {
    assert.equal(serialiseNoteMarkup(root([text('Just a note.')])), 'Just a note.');
});

test('bold and italic become markers', () => {
    const editor = root([
        text('Play '),
        el('STRONG', [text('slowly')]),
        text(' and '),
        el('EM', [text('listen')]),
        text('.')
    ]);
    assert.equal(serialiseNoteMarkup(editor), 'Play **slowly** and _listen_.');
});

test('legacy b and i tags count as emphasis', () => {
    const editor = root([el('B', [text('one')]), text(' '), el('I', [text('two')])]);
    assert.equal(serialiseNoteMarkup(editor), '**one** _two_');
});

test('inline styles from a paste count as emphasis', () => {
    const editor = root([el('SPAN', [text('bold')], { fontWeight: '700' })]);
    assert.equal(serialiseNoteMarkup(editor), '**bold**');
});

test('markers hug the words, not the spaces', () => {
    // "** padded **" would not be recognised as emphasis by any renderer, so a
    // selection that caught the surrounding spaces must still produce markers
    // tight against the words.
    const editor = root([text('a'), el('STRONG', [text(' padded ')]), text('b')]);
    assert.equal(serialiseNoteMarkup(editor), 'a **padded** b');
});

test('nested emphasis flattens to the outer marker', () => {
    // The wire format has no bold-inside-bold; **** would round-trip as visible
    // asterisks rather than as formatting.
    const editor = root([el('STRONG', [text('a '), el('B', [text('b')])])]);
    assert.equal(serialiseNoteMarkup(editor), '**a b**');
});

test('br and block elements become line breaks', () => {
    const editor = root([
        text('[What we did]'),
        el('BR'),
        text('Scales.'),
        el('DIV', [text('Next line')])
    ]);
    assert.equal(serialiseNoteMarkup(editor), '[What we did]\nScales.\nNext line');
});

test('list items serialise as dash bullets', () => {
    const editor = root([el('UL', [el('LI', [text('Scales')]), el('LI', [text('Clocks')])])]);
    assert.equal(serialiseNoteMarkup(editor), '- Scales\n- Clocks');
});

test('unknown elements collapse to their text', () => {
    // Pasted markup cannot survive as markup: nothing downstream should ever
    // receive HTML a tutor did not deliberately produce.
    const editor = root([el('SCRIPT', [text('alert(1)')]), el('A', [text('link')])]);
    assert.equal(serialiseNoteMarkup(editor), 'alert(1)link');
});

test('markup round-trips through the editor renderer', () => {
    const original = 'Play **slowly** and _listen_.';
    assert.equal(renderNoteMarkup(original), 'Play <strong>slowly</strong> and <em>listen</em>.');
});

test('renderNoteMarkup escapes before it formats', () => {
    assert.equal(
        renderNoteMarkup('**<script>alert(1)</script>**'),
        '<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>'
    );
});

test('stripNoteMarkers keeps bullets and drops emphasis', () => {
    assert.equal(stripNoteMarkers('- Practise **Clocks** _slowly_'), '- Practise Clocks slowly');
});

test('stripped text leaves a song title exactly matchable', () => {
    const stripped = stripNoteMarkers('We started **Clocks** today');
    assert.ok(stripped.includes('Clocks'));
    assert.ok(!stripped.includes('*'));
});

test('underscores inside words are not italic', () => {
    assert.equal(stripNoteMarkers('lesson_plan_v2'), 'lesson_plan_v2');
    assert.equal(renderNoteMarkup('lesson_plan_v2'), 'lesson_plan_v2');
});

test('toggleBulletLines adds bullets then removes them', () => {
    const added = toggleBulletLines(['Scales', 'Clocks']);
    assert.equal(added.bulleted, true);
    assert.deepEqual(added.lines, ['- Scales', '- Clocks']);

    const removed = toggleBulletLines(added.lines);
    assert.equal(removed.bulleted, false);
    assert.deepEqual(removed.lines, ['Scales', 'Clocks']);
});

test('toggleBulletLines leaves blank lines alone and does not double up', () => {
    const result = toggleBulletLines(['- Already', '', 'New']);
    assert.deepEqual(result.lines, ['- Already', '', '- New']);
});

test('rawNoteText does not normalise, so it can index a selection', () => {
    // Regression: line numbers were measured with serialiseNoteMarkup, which
    // trims and collapses blank runs. Every prefix came out short, the line
    // index shifted up, and toggling bullets on a selection bulleted the
    // [Practice Goals] heading sitting above it.
    const editor = root([text('\n\n\nA\n\n\nB  ')]);

    assert.equal(rawNoteText(editor), '\n\n\nA\n\n\nB  ');
    assert.equal(serialiseNoteMarkup(editor), 'A\n\nB');

    // The line the selection is really on, versus what the tidied text claims.
    assert.equal(rawNoteText(editor).split('\n').length - 1, 6);
    assert.equal(serialiseNoteMarkup(editor).split('\n').length - 1, 2);
});

test('clipboard HTML carries paragraphs, bullets and emphasis', () => {
    assert.equal(
        noteMarkupToHtml('Goals:\n- **Scales** daily\n- Clocks\n\nSee you next week.'),
        '<p>Goals:</p><ul><li><strong>Scales</strong> daily</li><li>Clocks</li></ul><p>See you next week.</p>'
    );
});

test('clipboard HTML cannot carry tutor-authored markup', () => {
    assert.equal(noteMarkupToHtml('<b>not mine</b>'), '<p>&lt;b&gt;not mine&lt;/b&gt;</p>');
});
