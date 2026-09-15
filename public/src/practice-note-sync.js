const DEFAULT_SOURCE = 'practice_chat_pwa';

function clean(value = '') {
    return `${value || ''}`.trim();
}

function stableHash(text = '') {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

export function buildPracticeNoteId({ studentId = '', lessonDate = '', rawNoteText = '' } = {}) {
    return `practice_note:${studentId || 'unknown'}:${lessonDate || 'unknown'}:${stableHash(rawNoteText).slice(0, 12)}`;
}

// Absent must stay absent. `Number('')` is 0, so a missing priorNoteAgeDays
// would otherwise arrive as "the previous note is from today" — a fact nobody
// asserted, on every session that has no previous note at all.
function positiveInt(value) {
    const raw = clean(value);
    if (!raw) return undefined;
    const number = Number(raw);
    return Number.isInteger(number) && number >= 0 ? number : undefined;
}

export function getPracticeChatContext(search = '') {
    const params = new URLSearchParams(search || '');
    return {
        studentId: clean(params.get('studentId')),
        studentName: clean(params.get('studentName')),
        tutor: clean(params.get('tutor')),
        practiceChatSecret: clean(params.get('practiceChatSecret')),
        dashboardBaseUrl: clean(params.get('dashboardBaseUrl')).replace(/\/+$/u, ''),
        // Six-week evaluation. The server decides who is prompted and how often
        // — this app receives a yes/no and a rate, never the roster, for the
        // same reason isLocalMmsWriteTestAvailable does not hold a tutor
        // allow-list: a public app must not publish who is in a trial.
        evalPrompt: params.get('evalPrompt') === '1',
        evalSample: positiveInt(params.get('evalSample')) || 1,
        // What the tutor had in front of them on the dashboard. `priorNoteExists`
        // is availability, not evidence of reading — the dashboard renders the
        // previous note automatically. Only `priorHistoryOpened` was a choice.
        priorNoteExists: params.get('priorNoteExists') === '1',
        priorNoteAgeDays: positiveInt(params.get('priorNoteAgeDays')),
        priorHistoryOpened: params.get('priorHistoryOpened') === '1'
    };
}

export function splitStructuredNoteText(text = '') {
    const sections = {
        whatWeDid: '',
        progressChallenges: '',
        practiceGoals: ''
    };
    const labels = [
        { key: 'whatWeDid', pattern: /^\[?what we did\]?:?$/iu },
        { key: 'progressChallenges', pattern: /^\[?progress\s*&\s*challenges\]?:?$/iu },
        { key: 'practiceGoals', pattern: /^\[?practice goals\]?:?$/iu }
    ];

    let currentKey = '';
    for (const line of `${text || ''}`.split(/\r?\n/u)) {
        const trimmed = line.trim();
        const label = labels.find((entry) => entry.pattern.test(trimmed));
        if (label) {
            currentKey = label.key;
            continue;
        }
        if (currentKey && trimmed) {
            sections[currentKey] = `${sections[currentKey] ? `${sections[currentKey]}\n` : ''}${trimmed}`;
        }
    }

    return sections;
}

function normaliseSongIds(value = []) {
    return [...new Set((Array.isArray(value) ? value : [])
        .map(clean)
        .filter(Boolean))].slice(0, 12);
}

function normaliseUnlistedSongTitles(value = []) {
    return [...new Set((Array.isArray(value) ? value : [])
        .map((title) => clean(title).slice(0, 120))
        .filter(Boolean))].slice(0, 6);
}

function normaliseMatchText(value = '') {
    return clean(value)
        .normalize('NFKD')
        .replace(/[’‘]/gu, "'")
        .replace(/[^a-z0-9']+/giu, ' ')
        .replace(/'/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLowerCase();
}

function hasSongCue(noteText = '', position = -1) {
    if (position < 0) return false;
    const prefix = noteText.slice(Math.max(0, position - 48), position).trimEnd();
    return /(?:worked on|work on|played|playing|practi[cs]ed|practi[cs]ing|learnt|learned|learning|song|piece|tune)(?:\s+the)?$/u.test(prefix);
}

/**
 * Produce review candidates, never selected facts. Matching is deliberately
 * exact after punctuation/case normalisation; duplicate catalogue titles are
 * suppressed unless the student's shelf disambiguates the ID.
 */
export function suggestPracticeNoteSongs({
    noteText = '',
    shelfSongs = [],
    catalogueSongs = [],
    limit = 6
} = {}) {
    const sections = splitStructuredNoteText(noteText);
    const sourceText = normaliseMatchText(sections.whatWeDid || noteText);
    if (!sourceText) return [];

    const shelfIds = new Set((Array.isArray(shelfSongs) ? shelfSongs : []).map((song) => clean(song?.songId)));
    const byId = new Map();
    for (const song of [...(Array.isArray(catalogueSongs) ? catalogueSongs : []), ...(Array.isArray(shelfSongs) ? shelfSongs : [])]) {
        const songId = clean(song?.songId);
        const title = clean(song?.title);
        if (!songId || !title) continue;
        byId.set(songId, { ...song, songId, title });
    }

    const byTitle = new Map();
    for (const song of byId.values()) {
        const matchTitle = normaliseMatchText(song.title);
        if (!matchTitle) continue;
        const entries = byTitle.get(matchTitle) || [];
        entries.push(song);
        byTitle.set(matchTitle, entries);
    }

    const suggestions = [];
    for (const [matchTitle, entries] of byTitle) {
        const paddedText = ` ${sourceText} `;
        const paddedTitle = ` ${matchTitle} `;
        const paddedPosition = paddedText.indexOf(paddedTitle);
        if (paddedPosition < 0) continue;
        const position = Math.max(0, paddedPosition - 1);
        const shelfEntries = entries.filter((song) => shelfIds.has(song.songId));
        const candidate = shelfEntries.length === 1
            ? shelfEntries[0]
            : entries.length === 1
                ? entries[0]
                : null;
        if (!candidate) continue;

        const wordCount = matchTitle.split(' ').filter(Boolean).length;
        if (wordCount === 1 && !hasSongCue(sourceText, position)) continue;
        const onShelf = shelfIds.has(candidate.songId);
        suggestions.push({
            ...candidate,
            onShelf,
            suggestionSource: onShelf ? 'current_shelf_exact' : 'catalogue_exact',
            matchPosition: position
        });
    }

    return suggestions
        .sort((a, b) => Number(b.onShelf) - Number(a.onShelf)
            || a.matchPosition - b.matchPosition
            || a.title.localeCompare(b.title))
        .slice(0, Math.max(0, limit))
        .map(({ matchPosition, ...song }) => song);
}

export function buildPracticeNoteSnapshot({
    context = {},
    noteText = '',
    songIds = [],
    unlistedSongTitles = [],
    now = new Date()
} = {}) {
    const rawNoteText = clean(noteText);
    if (!context.studentId || !rawNoteText) {
        return null;
    }

    const sections = splitStructuredNoteText(rawNoteText);
    const lessonDate = now.toISOString().slice(0, 10);
    return {
        noteId: buildPracticeNoteId({
            studentId: context.studentId,
            lessonDate,
            rawNoteText
        }),
        studentMmsId: context.studentId,
        studentName: context.studentName,
        tutorName: context.tutor,
        lessonDate,
        ...sections,
        rawNoteText,
        songIds: normaliseSongIds(songIds),
        unlistedSongTitles: normaliseUnlistedSongTitles(unlistedSongTitles),
        copiedToClipboard: true,
        attendanceStepOpened: true,
        source: DEFAULT_SOURCE,
        createdAt: now.toISOString()
    };
}

/**
 * Fetch the student's instrument and current songs, for use as a transcription
 * prompt. Best-effort: on any failure we transcribe with no prompt, which is
 * exactly the behaviour before this existed.
 */
export async function fetchPracticeChatMusicContext({
    dashboardBaseUrl = '',
    studentId = '',
    practiceChatSecret = '',
    fetchImpl = fetch
} = {}) {
    if (!dashboardBaseUrl || !studentId) {
        return { prompt: '', songs: [], catalogueSongs: [], songTitles: [], instrument: '' };
    }

    const url = `${dashboardBaseUrl}/api/practice-notes/music-context?studentId=${encodeURIComponent(studentId)}`;
    const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
            ...(practiceChatSecret ? { 'X-FirstChord-PracticeChat-Secret': practiceChatSecret } : {})
        }
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Music context lookup failed (${response.status})`);
    }

    return {
        prompt: payload.prompt || '',
        songs: Array.isArray(payload.songs) ? payload.songs
            .map((song) => ({
                songId: clean(song?.songId),
                title: clean(song?.title),
                status: clean(song?.status)
            }))
            .filter((song) => song.songId && song.title)
            .slice(0, 12) : [],
        catalogueSongs: Array.isArray(payload.catalogueSongs) ? payload.catalogueSongs
            .map((song) => ({
                songId: clean(song?.songId),
                title: clean(song?.title),
                artist: clean(song?.artist),
                contentType: clean(song?.contentType)
            }))
            .filter((song) => song.songId && song.title)
            .slice(0, 400) : [],
        songTitles: payload.songTitles || [],
        instrument: payload.instrument || ''
    };
}

export async function savePracticeNoteSnapshot({ dashboardBaseUrl = '', snapshot = {}, fetchImpl = fetch } = {}) {
    if (!dashboardBaseUrl || !snapshot) {
        return { skipped: true };
    }

    const { practiceChatSecret = '', ...snapshotPayload } = snapshot;
    const response = await fetchImpl(`${dashboardBaseUrl}/api/practice-notes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(practiceChatSecret ? { 'X-FirstChord-PracticeChat-Secret': practiceChatSecret } : {})
        },
        body: JSON.stringify(snapshotPayload)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Practice note save failed (${response.status})`);
    }

    return payload;
}

/**
 * Send session telemetry to the dashboard.
 *
 * Deliberately unlike `savePracticeNoteSnapshot`: that one throws so the caller
 * can warn a tutor their note did not save. This one never throws and never
 * reports. Measurement must not be able to interrupt, delay or fail a lesson,
 * so a dead network here is silent by design — the missing rows show up as a
 * gap in the evaluation, which is the correct place to feel it.
 *
 * `keepalive` lets the browser finish the request after the page goes away,
 * which is what makes the final write survive a tutor closing the panel.
 */
export async function savePracticeChatSession({
    dashboardBaseUrl = '',
    payload = null,
    practiceChatSecret = '',
    keepalive = false,
    fetchImpl = fetch
} = {}) {
    if (!dashboardBaseUrl || !payload?.sessionId || !payload?.studentId) {
        return { skipped: true };
    }

    try {
        const response = await fetchImpl(`${dashboardBaseUrl}/api/practice-chat-sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(practiceChatSecret ? { 'X-FirstChord-PracticeChat-Secret': practiceChatSecret } : {})
            },
            body: JSON.stringify(payload),
            keepalive
        });
        return { ok: response.ok, status: response.status };
    } catch {
        return { ok: false, skipped: true };
    }
}

export function isLocalMmsWriteTestAvailable({ context = {}, hostname = window.location.hostname } = {}) {
    const dashboardBaseUrl = clean(context.dashboardBaseUrl);
    const isAllowedHost = Boolean(hostname) && (
        hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === 'practice-chat-pwa.web.app'
    );
    // The server decides which tutors are enabled. Do not duplicate a rollout
    // allow-list in this public app.
    return Boolean(context.studentId && context.tutor && dashboardBaseUrl && isAllowedHost);
}

async function callPracticeNoteMmsTestRoute({
    dashboardBaseUrl = '',
    studentId = '',
    noteText = '',
    mode = 'dry_run',
    targetAttendanceId = '',
    attendanceStatus = 'Present',
    songIds = [],
    unlistedSongTitles = [],
    noteSnapshot = null,
    confirmedRecipientEmail = '',
    practiceChatSecret = '',
    fetchImpl = fetch
} = {}) {
    const response = await fetchImpl(`${dashboardBaseUrl}/api/practice-notes/mms-test`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(practiceChatSecret ? { 'X-FirstChord-PracticeChat-Secret': practiceChatSecret } : {})
        },
        body: JSON.stringify({
            studentMmsId: studentId,
            noteText,
            mode,
            targetAttendanceId,
            attendanceStatus,
            songIds: normaliseSongIds(songIds),
            unlistedSongTitles: normaliseUnlistedSongTitles(unlistedSongTitles),
            noteSnapshot,
            confirmLevel2Pilot: mode === 'execute',
            confirmRecipient: mode === 'execute' && attendanceStatus !== 'AbsentNoMakeup',
            confirmedRecipientEmail,
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `MMS test write failed (${response.status})`);
    }

    return payload;
}

// A shared lesson is delivered through its own route: one note, one attendance
// write per student on the MMS event, and one email per household. The server
// decides who shares a household and who carries the email — this app must never
// make that call, because getting it wrong means a duplicate email to a parent.
async function callPracticeNoteGroupRoute({
    dashboardBaseUrl = '',
    studentId = '',
    noteText = '',
    mode = 'dry_run',
    targetAttendanceId = '',
    attendanceStatus = 'Present',
    noteSnapshot = null,
    tutor = '',
    practiceChatSecret = '',
    fetchImpl = fetch
} = {}) {
    const response = await fetchImpl(`${dashboardBaseUrl}/api/practice-notes/group`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(practiceChatSecret ? { 'X-FirstChord-PracticeChat-Secret': practiceChatSecret } : {})
        },
        body: JSON.stringify({
            studentMmsId: studentId,
            noteText,
            mode,
            targetAttendanceId,
            attendanceStatus,
            noteSnapshot,
            tutor,
            confirmGroupDelivery: mode === 'execute'
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Group lesson delivery failed (${response.status})`);
    }

    return payload;
}

export function previewPracticeNoteGroup(options = {}) {
    return callPracticeNoteGroupRoute({ ...options, mode: 'dry_run' });
}

export function executePracticeNoteGroup(options = {}) {
    return callPracticeNoteGroupRoute({ ...options, mode: 'execute' });
}

export function previewPracticeNoteMmsTestWrite(options = {}) {
    return callPracticeNoteMmsTestRoute({
        ...options,
        mode: 'dry_run'
    });
}

export function executePracticeNoteMmsTestWrite(options = {}) {
    return callPracticeNoteMmsTestRoute({
        ...options,
        mode: 'execute'
    });
}
