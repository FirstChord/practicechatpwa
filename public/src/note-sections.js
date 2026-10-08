// The three section labels Practice Chat writes into every note.
//
// A contract with the dashboard, which reads these labels to lay out the
// parent's email, the student portal and the note timeline. Renaming one here
// alone would silently break those. Both repositories test against the same
// list in tests/fixtures/note-sections-contract.mjs (a mirrored file), so a
// rename means editing it in both on purpose.
export const NOTE_SECTION_LABELS = [
    '[What we did]',
    '[Progress & Challenges]',
    '[Practice Goals]'
];
