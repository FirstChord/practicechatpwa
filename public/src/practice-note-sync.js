const DEFAULT_SOURCE = 'practice_chat_pwa';
export const TEST_MMS_WRITE_STUDENT_ID = 'sdt_fBg9JN';
export const LEVEL_2_PILOT_TUTORS = ['Finn', 'Tom', 'Fennella'];

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
        practiceChatSecret: clean(params.get('practiceChatSecret')),
        dashboardBaseUrl: clean(params.get('dashboardBaseUrl')).replace(/\/+$/u, '')
    };
}

function normalisePilotTutor(value = '') {
    const cleaned = clean(value).toLowerCase();
    if (!cleaned) return '';
    if (cleaned === 'finn' || cleaned.includes('finn le marinel')) return 'Finn';
    if (cleaned === 'tom' || cleaned.includes('tom walters')) return 'Tom';
    if (cleaned === 'fennella' || cleaned.includes('fennella mccallum')) return 'Fennella';
    return clean(value);
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

export function isLocalMmsWriteTestAvailable({ context = {}, hostname = window.location.hostname } = {}) {
    const dashboardBaseUrl = clean(context.dashboardBaseUrl);
    const tutor = normalisePilotTutor(context.tutor);
    const isPilotTutor = LEVEL_2_PILOT_TUTORS.includes(tutor);
    const isTestStudent = context.studentId === TEST_MMS_WRITE_STUDENT_ID;
    const isAllowedHost = Boolean(hostname) && (
        hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === 'practice-chat-pwa.web.app'
    );
    return Boolean(context.studentId && dashboardBaseUrl && isAllowedHost && (isPilotTutor || isTestStudent));
}

async function callPracticeNoteMmsTestRoute({
    dashboardBaseUrl = '',
    studentId = '',
    noteText = '',
    mode = 'dry_run',
    targetAttendanceId = '',
    noteSnapshot = null,
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
            noteSnapshot,
            confirmLevel2Pilot: mode === 'execute'
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `MMS test write failed (${response.status})`);
    }

    return payload;
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
