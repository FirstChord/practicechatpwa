import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTE_SECTION_CONTRACT } from './fixtures/note-sections-contract.mjs';
import { NOTE_SECTION_LABELS } from '../public/src/note-sections.js';
import { renderEditorMarkup } from '../public/src/note-markup.js';

// Practice Chat's half of the contract: it writes exactly these labels. The
// dashboard's half checks it reads them. See the fixture for why.

test('Practice Chat writes exactly the contracted section labels', () => {
    assert.deepEqual(NOTE_SECTION_LABELS, NOTE_SECTION_CONTRACT.labels);
});

test('every contracted label is picked out in the editor', () => {
    const html = renderEditorMarkup(NOTE_SECTION_CONTRACT.sampleNote);
    assert.equal((html.match(/class="note-label"/g) || []).length, NOTE_SECTION_CONTRACT.labels.length);
});
