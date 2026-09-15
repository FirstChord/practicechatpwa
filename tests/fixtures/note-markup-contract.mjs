/**
 * @fileoverview The note-markup contract: what a tutor's note must render as.
 *
 * MIRRORED FILE. An identical copy lives in the other repository:
 *   music-school-dashboard/tests/fixtures/note-markup-contract.mjs
 *   practice-chat/tests/fixtures/note-markup-contract.mjs
 * Edit both, or the two renderers stop being held to the same contract.
 *
 * Two separate implementations turn a tutor's note into HTML. Practice Chat
 * renders it so the tutor can check the note before approving it; the dashboard
 * renders it again for the parent's email and the student portal. Nobody sees
 * both, so if one drifts the tutor approves one thing and the parent receives
 * another, silently.
 *
 * Each repository's own test checks its own renderer against this list, so the
 * check runs on both CIs without either needing the other repository checked
 * out. The contract:
 *
 *   dashboard  noteMarkupToHtml(input, { escape, join: '' })
 *   practice   noteMarkupToHtml(input)
 *
 * must both produce `html`.
 *
 * These cases were generated on 2026-09-15 from the behaviour the two
 * implementations already agreed on, so this records what is true rather than
 * what someone hoped was true. A deliberate change to the note format means
 * changing this file in both repositories on purpose — which is the point: it
 * turns a silent divergence into an edit somebody has to make twice.
 */
export const NOTE_MARKUP_CONTRACT = [
  {
    "name": "empty note",
    "input": "",
    "html": ""
  },
  {
    "name": "plain sentence",
    "input": "Worked through the C major scale.",
    "html": "<p>Worked through the C major scale.</p>"
  },
  {
    "name": "inline bold",
    "input": "Focus on **tone** this week.",
    "html": "<p>Focus on <strong>tone</strong> this week.</p>"
  },
  {
    "name": "inline italic",
    "input": "Keep it *light* in the chorus.",
    "html": "<p>Keep it *light* in the chorus.</p>"
  },
  {
    "name": "bold and italic together",
    "input": "*italic* mid **bold** line",
    "html": "<p>*italic* mid <strong>bold</strong> line</p>"
  },
  {
    "name": "whole-line heading",
    "input": "**What we did:**",
    "html": "<p><strong>What we did:</strong></p>"
  },
  {
    "name": "heading then text",
    "input": "**What we did:**\nC major scale, hands together.",
    "html": "<p><strong>What we did:</strong><br>C major scale, hands together.</p>"
  },
  {
    "name": "bracket heading",
    "input": "[What we did]\nC major scale",
    "html": "<p>[What we did]<br>C major scale</p>"
  },
  {
    "name": "single bullet",
    "input": "- Scales",
    "html": "<ul><li>Scales</li></ul>"
  },
  {
    "name": "bullet list",
    "input": "- Scales\n- New piece\n- Sight reading",
    "html": "<ul><li>Scales</li><li>New piece</li><li>Sight reading</li></ul>"
  },
  {
    "name": "star bullets",
    "input": "* Scales\n* Arpeggios",
    "html": "<ul><li>Scales</li><li>Arpeggios</li></ul>"
  },
  {
    "name": "full structured note",
    "input": "**What we did:**\n- C major scale\n- Bar 12 of the new piece\n\n**Progress & challenges:**\nRhythm in bar 12 is still tricky.\n\n**Practice goals:**\n- Slow practice, bars 8-16\n- Scale hands together",
    "html": "<p><strong>What we did:</strong></p><ul><li>C major scale</li><li>Bar 12 of the new piece</li></ul><p><strong>Progress &amp; challenges:</strong><br>Rhythm in bar 12 is still tricky.</p><p><strong>Practice goals:</strong></p><ul><li>Slow practice, bars 8-16</li><li>Scale hands together</li></ul>"
  },
  {
    "name": "html-ish characters",
    "input": "Use the <strong> tag & the \"quote\" marks",
    "html": "<p>Use the &lt;strong&gt; tag &amp; the &quot;quote&quot; marks</p>"
  },
  {
    "name": "ampersand in a name",
    "input": "Duet with Rosie & Johnny",
    "html": "<p>Duet with Rosie &amp; Johnny</p>"
  },
  {
    "name": "blank line between paragraphs",
    "input": "First thought.\n\nSecond thought.",
    "html": "<p>First thought.</p><p>Second thought.</p>"
  },
  {
    "name": "trailing whitespace",
    "input": "Trailing spaces here   ",
    "html": "<p>Trailing spaces here</p>"
  },
  {
    "name": "heading with no colon",
    "input": "**Practice goals**\n- one",
    "html": "<p><strong>Practice goals</strong></p><ul><li>one</li></ul>"
  }
];
