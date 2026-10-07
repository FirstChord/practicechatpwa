// Practice Chat - Text Processor Module
// Handles text cleanup and enhancement for speech recognition output.
//
// Every rule here rewrites text that ends up in a parent's inbox, so the rules
// are deliberately conservative:
//
//   1. Every pattern is a RegExp anchored with word boundaries. The previous
//      version built patterns from bare strings, so "pics"->"picks" fired inside
//      "topics" (-> "topicks") and "f minus"->"F minor" fired inside "off minus"
//      (-> "ofF minor"). Anchoring is what stops that whole class of bug.
//   2. A rule only survives if its trigger phrase is implausible as real lesson
//      speech. "door in" -> "Dorian" was dropped for this reason: a tutor can
//      say "the door in the room". If in doubt, leave the words alone — a tutor
//      editing one word beats the system silently inventing one.
//   3. Nothing here is a safety net. Profanity that arrives via a mis-hearing is
//      caught on the way OUT by checkNoteSafety(), which flags for review and
//      never substitutes.
//
// tests/text-processor.test.mjs pins the behaviour, including the corruption
// cases above. Add a fixture there before adding a rule here.

/**
 * Music-specific terminology corrections.
 * Each entry: a word-boundary-anchored pattern and its replacement.
 */
const MUSIC_TERMINOLOGY_FIXES = [
  // Grammar fixes
  { pattern: /\bI'?d to\b/gi, replace: "I'd like to" },
  { pattern: /\bI'?d you to\b/gi, replace: "I'd like you to" },
  { pattern: /\bgoing to to\b/gi, replace: 'going to' },
  { pattern: /\bneed to to\b/gi, replace: 'need to' },

  // Scale corrections
  { pattern: /\bf minuscale\b/gi, replace: 'F minor scale' },
  { pattern: /\b(minor|major) scale scale\b/gi, replace: '$1 scale' },
  { pattern: /\bf minus\b/gi, replace: 'F minor' },
  { pattern: /\bnot your minor\b/gi, replace: 'natural minor' },
  { pattern: /\bhole tone scale\b/gi, replace: 'whole tone scale' },

  // Note-value corrections
  { pattern: /\bsix teeth (notes?)\b/gi, replace: 'sixteenth $1' },
  { pattern: /\bate (notes?)\b/gi, replace: 'eighth $1' },

  // Musical terms
  { pattern: /\bD\.?S\.? alcohol da\b/gi, replace: 'D.S. al coda' },
  { pattern: /\bD\.?S\.? al coda\b/gi, replace: 'D.S. al coda' },
  { pattern: /\bin to veil\b/gi, replace: 'interval' },
  { pattern: /\bdoor in mode\b/gi, replace: 'Dorian mode' },
  { pattern: /\bmix a Lydian\b/gi, replace: 'Mixolydian' },
  { pattern: /\bmic soul idiom\b/gi, replace: 'Mixolydian' },
  { pattern: /\bcave dance\b/gi, replace: 'cadence' },

  // Guitar-specific terms
  { pattern: /\bfret board\b/gi, replace: 'fretboard' },
  { pattern: /\bbar chord\b/gi, replace: 'barre chord' },
  { pattern: /\bbar code\b/gi, replace: 'barre chord' },
  { pattern: /\bplec\b/gi, replace: 'pick' },
  { pattern: /\bfinger picking\b/gi, replace: 'fingerpicking' },
  { pattern: /\bdown stroke\b/gi, replace: 'downstroke' },
  { pattern: /\bup stroke\b/gi, replace: 'upstroke' },
];

/**
 * Disfluencies safe to remove. Deliberately limited to sounds nobody types on
 * purpose. The old list also stripped "actually", "basically", "kind of",
 * "I mean", "sort of" and "you know" — those carry meaning or tone ("he
 * actually managed it" is not "he managed it"), so they stay.
 */
const FILLER_WORDS = ['um', 'uh', 'uhm', 'erm', 'er', 'ah'];

/**
 * Words safe to de-duplicate when stuttered. Restricted to function words that
 * are never repeated for emphasis, so "no no" and "very very" survive intact.
 */
const STUTTER_WORDS = [
  'the', 'a', 'an', 'to', 'of', 'and', 'that', 'is', 'was',
  'we', 'i', 'it', 'he', 'she', 'they', 'you',
];

/**
 * Terms that must never reach a parent without a human looking first.
 *
 * These are checked against the FINISHED note, because the risk is a
 * mis-transcription ("funk" -> the obvious), not something a tutor typed. A hit
 * flags for review; it is never auto-substituted, since guessing what was meant
 * turns one error into two. `likelyMeant` is a hint for the tutor, not a fix.
 */
const RISKY_OUTPUT_TERMS = [
  // Swearing and slurs.
  { pattern: /\bf+u+c+k\w*\b/gi, likelyMeant: 'funk, or pluck' },
  { pattern: /\bsh[i1]t\w*\b/gi, likelyMeant: 'sheet, or shift' },
  { pattern: /\bbitch\w*\b/gi, likelyMeant: 'pitch' },
  { pattern: /\bprick\w*\b/gi, likelyMeant: 'pick' },
  { pattern: /\bdick\w*\b/gi, likelyMeant: 'pick, or lick' },
  { pattern: /\bcock\w*\b/gi, likelyMeant: '' },
  { pattern: /\bcunt\w*\b/gi, likelyMeant: 'count' },
  { pattern: /\btwat\w*\b/gi, likelyMeant: '' },
  { pattern: /\bwank\w*\b/gi, likelyMeant: '' },
  { pattern: /\bbastard\w*\b/gi, likelyMeant: '' },
  { pattern: /\barse\w*\b/gi, likelyMeant: '' },
  { pattern: /\bass\b/gi, likelyMeant: '' },
  { pattern: /\bslut\w*\b/gi, likelyMeant: '' },
  { pattern: /\bwhore\w*\b/gi, likelyMeant: '' },
  { pattern: /\bnigg\w*\b/gi, likelyMeant: '' },
  { pattern: /\bfagg?\w*\b/gi, likelyMeant: '' },
  { pattern: /\bretard\w*\b/gi, likelyMeant: '' },
  { pattern: /\bcrap\w*\b/gi, likelyMeant: 'clap' },
  { pattern: /\bdamn\w*\b/gi, likelyMeant: '' },
  // Band name, and a recurring lesson topic: flagging it weekly teaches a tutor
  // to click past the check.
  { pattern: /\bbloody\b(?!\s+valentine)/gi, likelyMeant: '' },
  { pattern: /\bpiss\w*\b/gi, likelyMeant: '' },
  { pattern: /\bbollock\w*\b/gi, likelyMeant: '' },
  { pattern: /\bbugger\w*\b/gi, likelyMeant: '' },
  { pattern: /\btosser\w*\b/gi, likelyMeant: '' },
  { pattern: /\bbell ?end\w*\b/gi, likelyMeant: '' },
  { pattern: /\bpuss(y|ies)\b/gi, likelyMeant: '' },
  { pattern: /\bcum\b/gi, likelyMeant: 'come' },
  { pattern: /\bspunk\w*\b/gi, likelyMeant: '' },
  { pattern: /\bshag(s|ged|ging)?\b/gi, likelyMeant: '' },
  { pattern: /\bpaki\w*\b/gi, likelyMeant: '' },
  { pattern: /\bspa(stic|z|zzy)\b/gi, likelyMeant: '' },
  { pattern: /\btrann(y|ies)\b/gi, likelyMeant: '' },

  // Sexual wording. Written to a child's family, this needs a second look even
  // when it was said on purpose (describing a song's style, say). "Sex" and
  // "sexy" are also plausible mishearings of "sax" and "six".
  { pattern: /\bsex\b/gi, likelyMeant: 'sax, or six' },
  { pattern: /\bsex(y|ier|iest|ual\w*|uality)\b/gi, likelyMeant: '' },
  { pattern: /\bseduc\w*\b/gi, likelyMeant: '' },
  { pattern: /\bsensual\w*\b/gi, likelyMeant: '' },
  { pattern: /\berotic\w*\b/gi, likelyMeant: '' },
  { pattern: /\bhorny\b/gi, likelyMeant: 'horn' },
  { pattern: /\bkinky\b/gi, likelyMeant: '' },
  { pattern: /\bporn\w*\b/gi, likelyMeant: '' },
  { pattern: /\borgasm\w*\b/gi, likelyMeant: '' },
  { pattern: /\b(nude|nudes|naked)\b/gi, likelyMeant: '' },
  { pattern: /\bboob\w*\b/gi, likelyMeant: '' },
  { pattern: /\btits\b/gi, likelyMeant: '' },
  { pattern: /\b(penis|vagina|genital\w*)\b/gi, likelyMeant: '' },
  { pattern: /\brap(e|ed|es|ist)\b/gi, likelyMeant: 'rap' },
  { pattern: /\bmolest\w*\b/gi, likelyMeant: '' },

  // Possible safeguarding disclosures. These belong with the safeguarding lead,
  // not in an email home: the reviewer may be the only person who sees it.
  { pattern: /\bsuicid\w*\b/gi, likelyMeant: '', category: 'safeguarding' },
  { pattern: /\bself[- ]?harm\w*\b/gi, likelyMeant: '', category: 'safeguarding' },
  { pattern: /\b(kill|hurt|cut|cutting|harm)\s+(myself|himself|herself|themselves|themself)\b/gi, likelyMeant: '', category: 'safeguarding' },
  { pattern: /\babus(e|ed|es|ing|ive)\b/gi, likelyMeant: '', category: 'safeguarding' },
  { pattern: /\bbull(y|ied|ies|ying)\b/gi, likelyMeant: '', category: 'safeguarding' },

  // Drugs and drink.
  // "Drunk Drivers/Killer Whales" is a song title on a student's shelf.
  { pattern: /\b(cocaine|heroin|cannabis|weed|stoned)\b/gi, likelyMeant: '' },
  { pattern: /\bdrunk\b(?!\s+drivers)/gi, likelyMeant: '' },

  // Insults: a note home should never call a student these, even in jest.
  { pattern: /\b(stupid|idiot\w*|dumb|useless|pathetic|ugly)\b/gi, likelyMeant: '' },
];

function removeFillerWords(text) {
  return FILLER_WORDS.reduce(
    (acc, filler) => acc.replace(new RegExp(`\\b${filler}\\b`, 'gi'), ' '),
    text
  );
}

function collapseStutters(text) {
  return STUTTER_WORDS.reduce(
    (acc, word) => acc.replace(new RegExp(`\\b(${word})(\\s+\\1)+\\b`, 'gi'), '$1'),
    text
  );
}

/**
 * Enhanced text cleanup function
 * @param {string} text - The raw speech text to clean
 * @returns {Object} - { text: cleanedText, enhancements: enhancementsList }
 */
export function enhancedCleanupSpeechText(text) {
    if (!text || !text.trim()) return { text: text || '', enhancements: [] };

    const original = text.trim();
    let cleaned = original;
    let enhancements = [];

    try {
        // Step 1: Remove disfluencies and stutters
        const beforeFillers = cleaned;
        cleaned = removeFillerWords(cleaned);
        cleaned = collapseStutters(cleaned);
        if (cleaned !== beforeFillers) {
            enhancements.push('Removed filler words');
        }

        // Step 2: Fix common speech recognition errors
        for (const { pattern, replace } of MUSIC_TERMINOLOGY_FIXES) {
            cleaned = cleaned.replace(pattern, replace);
        }

        // Step 3: Enhanced capitalization
        cleaned = cleaned.replace(/^\s*([a-z])/, (match, letter) =>
            match.replace(letter, letter.toUpperCase()));

        // Capitalize after periods
        cleaned = cleaned.replace(/\.\s+([a-z])/g, (match, letter) => '. ' + letter.toUpperCase());

        // Step 4: Professional tone improvements
        cleaned = cleaned.replace(/\bgonna\b/gi, 'going to');
        cleaned = cleaned.replace(/\bwanna\b/gi, 'want to');
        cleaned = cleaned.replace(/\bgotta\b/gi, 'need to');

        // Step 5: Clean up spacing
        cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();
        // Tidy spaces stranded before punctuation by filler removal
        cleaned = cleaned.replace(/\s+([,.;:!?])/g, '$1');
        if (!/[.!?]$/.test(cleaned)) {
            cleaned += '.';
        }

        // Remove double periods
        cleaned = cleaned.replace(/\.\.+/g, '.');

        // Fix spacing around periods
        cleaned = cleaned.replace(/\s*\.\s*/g, (match) => {
            return match.includes('\n') ? '.\n' : '. ';
        }).trim();

        if (cleaned !== original && !enhancements.length) {
            enhancements.push('Grammar and clarity improved');
        }

    } catch (error) {
        console.error('Text cleanup error:', error);
        return { text: text, enhancements: ['Cleanup failed, using original text'] };
    }

    return {
        text: cleaned,
        enhancements: enhancements.join(', ')
    };
}

/**
 * Check a finished note for text that should not reach a parent unreviewed.
 *
 * Flags only — never rewrites. Callers should require an explicit human
 * acknowledgement before sending a note with findings, rather than blocking it
 * outright: a false positive must not make a legitimate note unsendable.
 *
 * @param {string} text - The finished note text
 * @returns {Object} - { ok: boolean, findings: [{ term, likelyMeant, category }] }
 *   category is 'safeguarding' for a possible disclosure, else 'wording'.
 */
export function checkNoteSafety(text) {
    const value = `${text || ''}`;
    if (!value.trim()) return { ok: true, findings: [] };

    const findings = [];
    const seen = new Set();

    for (const { pattern, likelyMeant, category = 'wording' } of RISKY_OUTPUT_TERMS) {
        // Fresh regex per call: the shared literals carry /g and therefore
        // lastIndex state.
        const matches = value.match(new RegExp(pattern.source, 'gi')) || [];
        for (const match of matches) {
            const key = match.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            findings.push({ term: match, likelyMeant, category });
        }
    }

    return { ok: findings.length === 0, findings };
}

/**
 * Basic cleanup function
 * @param {string} text - The raw speech text to clean
 * @returns {string} - Cleaned text
 */
export function cleanupSpeechText(text) {
    try {
        return enhancedCleanupSpeechText(text).text;
    } catch (error) {
        console.error('Basic cleanup error:', error);
        return text;
    }
}
