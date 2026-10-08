/**
 * @fileoverview The note-sections contract: the labels Practice Chat writes,
 * and what the dashboard must make of them.
 *
 * MIRRORED FILE. An identical copy lives in the other repository:
 *   music-school-dashboard/tests/fixtures/note-sections-contract.mjs
 *   practice-chat/tests/fixtures/note-sections-contract.mjs
 * Edit both, or the writer and the reader stop being held to the same labels.
 *
 * Practice Chat starts every note with these three labels; the dashboard reads
 * them to split the note into sections for the parent's email, the student
 * portal and the timeline. A label renamed on one side alone fails silently:
 * the email simply loses its sections. Each repository tests its own side
 * against this file, so a rename becomes an edit somebody has to make twice.
 *
 *   practice   NOTE_SECTION_LABELS (public/src/note-sections.js) === labels
 *   dashboard  parsePracticeNoteSections(sampleNote) === sections
 *
 * Recorded 2026-10-08 from what both sides already did.
 */
export const NOTE_SECTION_CONTRACT = {
    labels: ['[What we did]', '[Progress & Challenges]', '[Practice Goals]'],
    sampleNote: '[What we did]\nScales and Let It Be.\n\n[Progress & Challenges]\nThe chorus went well.\n\n[Practice Goals]\nSlow F to C changes after school.',
    sections: {
        whatWeDid: 'Scales and Let It Be.',
        progressChallenges: 'The chorus went well.',
        practiceGoals: 'Slow F to C changes after school.'
    }
};
