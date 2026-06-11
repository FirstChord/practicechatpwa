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

export function getPracticeChatContext(search = '') {
    const params = new URLSearchParams(search || '');
    return {
        studentId: clean(params.get('studentId')),
        studentName: clean(params.get('studentName')),
        tutor: clean(params.get('tutor')),
        dashboardBaseUrl: clean(params.get('dashboardBaseUrl')).replace(/\/+$/u, '')
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

export function buildPracticeNoteSnapshot({ context = {}, noteText = '', now = new Date() } = {}) {
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
        copiedToClipboard: true,
        attendanceStepOpened: true,
        source: DEFAULT_SOURCE,
        createdAt: now.toISOString()
    };
}

export async function savePracticeNoteSnapshot({ dashboardBaseUrl = '', snapshot = {}, fetchImpl = fetch } = {}) {
    if (!dashboardBaseUrl || !snapshot) {
        return { skipped: true };
    }

    const response = await fetchImpl(`${dashboardBaseUrl}/api/practice-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Practice note save failed (${response.status})`);
    }

    return payload;
}
