/**
 * Note markup: the bridge between the rich editor and the plain-text note.
 *
 * Tutors bold and italicise in the contenteditable, but the note that gets
 * saved, hashed, emailed and shown in the portal stays plain text. This module
 * is the only place that converts between the two:
 *
 *   **bold**      _italic_      "- " at the start of a line for a bullet
 *
 * The same three markers are understood by the dashboard
 * (`lib/notes-markup.mjs`). Keep the two in step — the same note
 * has to look the same in a parent's email and in the student portal.
 *
 * Serialising *out of* the DOM rather than trusting it is what keeps this safe:
 * only <strong>/<b> and <em>/<i> mean anything, and every other element
 * collapses to its text. Pasted markup therefore cannot survive as markup, so
 * nothing downstream ever receives HTML a tutor did not deliberately produce.
 *
 * Bullets are literal "- " text rather than a real <ul>. The editor is
 * white-space: pre-wrap and already shows the tutor its own [section] markers,
 * so a visible dash is consistent with what the box promises: what you see is
 * what gets sent.
 */

const BOLD = /\*\*(?!\s)([^\n*]+?)(?<!\s)\*\*/g;
const ITALIC = /(^|[^\w*])_(?!\s)([^\n_]+?)(?<!\s)_(?![\w*])/g;
export const BULLET_PREFIX = '- ';

// Numeric node types rather than the DOM's Node.* constants, so the walk can be
// exercised in Node against a plain object tree.
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const BOLD_TAGS = new Set(['STRONG', 'B']);
const ITALIC_TAGS = new Set(['EM', 'I']);
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'TR', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

export function stripNoteMarkers(value = '') {
  return `${value || ''}`
    .replace(BOLD, '$1')
    .replace(ITALIC, '$1$2');
}

export function escapeHtml(value = '') {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Browsers disagree about how bold is expressed. With styleWithCSS off we get
// <b>/<strong>, but a paste or an older engine can produce an inline style
// instead, so both are treated as emphasis.
function emphasisOf(el) {
  if (BOLD_TAGS.has(el.tagName)) return 'bold';
  if (ITALIC_TAGS.has(el.tagName)) return 'italic';

  const weight = el.style?.fontWeight || '';
  if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) return 'bold';
  if (el.style?.fontStyle === 'italic') return 'italic';

  return '';
}

function wrap(inner, emphasis) {
  const trimmed = inner.trim();
  if (!trimmed) return inner;
  // Emphasis markers must hug the words, so any surrounding whitespace is moved
  // outside the marker rather than swallowed by it.
  const lead = inner.slice(0, inner.length - inner.trimStart().length);
  const tail = inner.slice(inner.trimEnd().length);
  const marked = emphasis === 'bold' ? `**${trimmed}**` : `_${trimmed}_`;
  return `${lead}${marked}${tail}`;
}

/**
 * Walk a contenteditable and produce the plain-text note.
 *
 * Emphasis nested inside emphasis is flattened to the outermost marker: the
 * wire format has no notion of bold-inside-bold, and emitting `****x****` would
 * round-trip into visible asterisks.
 */
export function serialiseNoteMarkup(root) {
  return rawNoteText(root)
    // contenteditable inserts a non-breaking space for a trailing typed space.
    // Written as an escape rather than the literal character, which is
    // invisible in a diff and easy to delete by accident.
    .replace(/\u00A0/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * The same walk without the tidy-up.
 *
 * Mapping a selection onto line numbers means measuring the text before it, and
 * that measurement is only valid if it uses the identical rules as the text it
 * indexes into. `serialiseNoteMarkup` trims and collapses blank runs, which
 * shortens every prefix and silently shifts the line index — which is how a
 * bullet toggle ended up capturing the heading above the selection.
 */
export function rawNoteText(root) {
  if (!root) return '';

  let out = '';

  const startBlock = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };

  const walk = (node, emphasis) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === TEXT_NODE) {
        out += child.data;
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;

      const tag = child.tagName;

      if (tag === 'BR') {
        out += '\n';
        continue;
      }

      if (tag === 'LI') {
        startBlock();
        out += BULLET_PREFIX;
        walk(child, emphasis);
        continue;
      }

      if (BLOCK_TAGS.has(tag)) {
        startBlock();
        walk(child, emphasis);
        continue;
      }

      const own = emphasisOf(child);
      if (own && !emphasis) {
        const before = out.length;
        walk(child, own);
        out = out.slice(0, before) + wrap(out.slice(before), own);
        continue;
      }

      walk(child, emphasis);
    }
  };

  walk(root, '');

  // Non-breaking spaces are what contenteditable inserts for a typed space at
  // the end of a line; they must not reach the note as a different character.
  return out;
}

/**
 * Turn a stored note back into editor HTML, so a restored draft keeps its
 * emphasis. Escapes first for the same reason the dashboard does: markers are
 * ASCII and survive escaping, so the only tags in the result are ours.
 */
export function renderNoteMarkup(text = '') {
  return escapeHtml(text)
    .replace(BOLD, '<strong>$1</strong>')
    .replace(ITALIC, '$1<em>$2</em>');
}

/**
 * Block-level HTML for the clipboard.
 *
 * The legacy flow copies the note and the tutor pastes it into MMS by hand, so
 * without an HTML flavour they would paste literal asterisks. MMS's rich editor
 * takes the text/html; anything plainer falls back to the markers.
 *
 * This knowingly repeats the block rules in the dashboard's
 * `lib/notes-markup.mjs`. The two live in separate repositories and the
 * clipboard is the one destination the dashboard never sees, so a shared module
 * is not available; keep them in step by hand if the markers ever change.
 */
export function noteMarkupToHtml(text = '') {
    return `${text || ''}`
        .trim()
        .split(/\n{2,}/u)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => {
            const blocks = [];
            for (const line of paragraph.split(/\r?\n/u)) {
                const bullet = line.match(/^[ \t]*[-*][ \t]+(.*)$/);
                const type = bullet ? 'ul' : 'p';
                if (blocks[blocks.length - 1]?.type !== type) blocks.push({ type, items: [] });
                blocks[blocks.length - 1].items.push(bullet ? bullet[1] : line);
            }
            return blocks
                .map(({ type, items }) => (type === 'ul'
                    ? `<ul>${items.map((item) => `<li>${renderNoteMarkup(item)}</li>`).join('')}</ul>`
                    : `<p>${items.map((item) => renderNoteMarkup(item)).join('<br>')}</p>`))
                .join('');
        })
        .join('');
}

/**
 * Toggle "- " on every line the selection touches. Returns the new text and
 * whether bullets were added, so the caller can keep the button state honest.
 */
export function toggleBulletLines(lines = []) {
  const touched = lines.filter((line) => line.trim());
  const allBulleted = touched.length > 0 && touched.every((line) => /^[ \t]*[-*][ \t]+/.test(line));

  return {
    bulleted: !allBulleted,
    lines: lines.map((line) => {
      if (!line.trim()) return line;
      if (allBulleted) return line.replace(/^([ \t]*)[-*][ \t]+/, '$1');
      return /^[ \t]*[-*][ \t]+/.test(line) ? line : `${BULLET_PREFIX}${line}`;
    }),
  };
}
