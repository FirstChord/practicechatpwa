import assert from 'node:assert/strict';
import test from 'node:test';

import { noteMarkupToHtml } from '../public/src/note-markup.js';
import { NOTE_MARKUP_CONTRACT } from './fixtures/note-markup-contract.mjs';

// This app renders a tutor's note so they can check it before approving. The
// dashboard renders the same note again, with its own implementation, for the
// parent's email and the student portal. Nobody sees both — so a change here
// that the dashboard does not match means the tutor approves one thing and the
// parent receives another, with nothing to notice it.
//
// The fixture is mirrored in both repositories and each side tests only its own
// renderer, so this runs on both CIs without either needing the other checked
// out. Changing the note format is then an edit somebody has to make twice, on
// purpose, instead of a silent divergence.
test('every note in the shared contract renders as the contract says', () => {
    for (const { name, input, html } of NOTE_MARKUP_CONTRACT) {
        assert.equal(
            noteMarkupToHtml(input),
            html,
            `"${name}" no longer matches the shared note-markup contract. If this change is deliberate, update tests/fixtures/note-markup-contract.mjs in BOTH repositories; otherwise what the tutor sees has drifted from what the parent receives.`
        );
    }
});

test('the contract still covers the shapes a real note is made of', () => {
    // A contract that quietly loses its cases stops protecting anything, so the
    // shapes themselves are asserted rather than just the count.
    const inputs = NOTE_MARKUP_CONTRACT.map((entry) => entry.input).join('\n');
    assert.match(inputs, /\*\*[^*]+:\*\*/u, 'no whole-line heading case');
    assert.match(inputs, /^- /mu, 'no bullet case');
    assert.match(inputs, /\[What we did\]/u, 'no bracket heading case');
    assert.match(inputs, /&/u, 'no HTML-escaping case');
    assert.ok(NOTE_MARKUP_CONTRACT.some((entry) => entry.input === ''), 'no empty-note case');
    assert.ok(NOTE_MARKUP_CONTRACT.length >= 15, 'the contract has shrunk');
});
