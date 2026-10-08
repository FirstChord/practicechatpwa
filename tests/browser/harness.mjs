/**
 * @fileoverview Browser test harness: the real Practice Chat in a real browser,
 * with a fake dashboard and a fake microphone.
 *
 * Hermetic by construction. public/ is served from a local server; every
 * dashboard API call is answered here and recorded; the ASR client module is
 * replaced with one the test drives; any other outbound request is aborted
 * (fonts included, so a result never depends on the network). Nothing can
 * reach MMS, the dashboard, OpenAI or a real student. Fixtures are synthetic:
 * this repository is public.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

export function startServer() {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const file = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
        } catch {
            res.writeHead(404).end();
        }
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
        resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    }));
}

// The fake microphone. Each stop() announces a processing line, waits for the
// test to call window.__asr.release(text | Error), then reports it.
const FAKE_ASR = `
export const DEFAULT_ASR_MODEL = 'whisper-1';
export function resolveAsrModel() { return DEFAULT_ASR_MODEL; }
window.__asr = { pending: null, release(value) { const p = this.pending; this.pending = null; p?.(value); }, auto: null };
export class WhisperASRClient {
    constructor() { this.onPartialTranscript = null; this.onFinalTranscript = null; this.onError = null; }
    async start() {}
    async stop() {
        this.onPartialTranscript?.('Tuning up the transcript…');
        const value = window.__asr.auto !== null
            ? window.__asr.auto
            : await new Promise((resolve) => { window.__asr.pending = resolve; });
        if (value instanceof Error) throw value;
        this.onFinalTranscript?.(value);
        return value;
    }
}`;

const lessonStart = new Date();
lessonStart.setHours(16, 0, 0, 0);
export const ATTENDANCE = { attendanceId: 'att_test_1', eventStartDate: lessonStart.toISOString(), attendanceStatus: 'Unrecorded' };

function defaultApi(key, body) {
    if (key === 'mms-test') {
        return body.mode === 'execute'
            ? { targetAttendance: { ...ATTENDANCE, attendanceStatus: body.attendanceStatus }, candidateAttendances: [ATTENDANCE], requestedAttendanceStatus: body.attendanceStatus, practiceNoteLog: { ok: true, noteId: 'note_test' }, emailNotes: { ok: true }, practiceNoteEmail: { toEmail: 'parent@example.com' } }
            : { targetAttendance: ATTENDANCE, candidateAttendances: [ATTENDANCE], recipients: [{ name: 'Parent', email: 'parent@example.com' }], targetSelection: { label: 'Today’s lesson.' } };
    }
    if (key === 'group') return { isGroup: false };
    if (key === 'music-context') return { songs: [{ songId: 'song_a', title: 'Let It Be', status: 'current' }], catalogueSongs: [{ songId: 'song_a', title: 'Let It Be', artist: 'The Beatles' }] };
    return { ok: true };
}

let browser;
async function getBrowser() {
    // CI installs Playwright's Chromium; locally the system Chrome is used.
    browser ??= await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
    return browser;
}

export async function closeBrowser() {
    await browser?.close();
    browser = undefined;
}

/**
 * Open Practice Chat. `dashboard: false` opens it as from a bookmark.
 * Returns { page, calls, errors, close }; `calls` records every API request.
 */
export async function openApp(server, { width = 768, height = 900, dashboard = true, api = defaultApi, autoAnswer = null } = {}) {
    const context = await (await getBrowser()).newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const calls = [];
    const errors = [];
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== server.origin) return route.abort();
        if (url.pathname.startsWith('/api/')) {
            const key = url.pathname.split('/').pop();
            const body = route.request().postDataJSON?.() || {};
            calls.push({ key, ...body });
            return route.fulfill({ json: api(key, body) });
        }
        if (url.pathname === '/src/asr-client.js') return route.fulfill({ contentType: 'text/javascript', body: FAKE_ASR });
        return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const params = dashboard
        ? new URLSearchParams({ studentId: 'sdt_TEST01', studentName: 'Test Student', tutor: 'Test Tutor', dashboardBaseUrl: server.origin })
        : new URLSearchParams();
    await page.goto(`${server.origin}/?${params}`);
    await page.locator('#mainActionBtn').waitFor();
    if (autoAnswer !== null) await page.evaluate((text) => { window.__asr.auto = text; }, autoAnswer);
    // Finish the entrance animation so positions are final.
    await page.evaluate(() => document.getAnimations().forEach((a) => {
        if (a.effect?.getTiming().iterations !== Infinity) a.finish();
    }));
    return { page, calls, errors, close: () => context.close() };
}

/** Record one answer with the fake mic and wait until it is shown. */
export async function answer(page, text) {
    await page.click('#mainActionBtn');
    await page.waitForFunction(() => document.getElementById('mainActionText').textContent === 'Listening…');
    await page.click('#mainActionBtn');
    await page.waitForFunction(() => window.__asr.pending || window.__asr.auto !== null);
    await page.evaluate((value) => { if (window.__asr.pending) window.__asr.release(value); }, text);
    await page.waitForFunction(() => !document.getElementById('mainActionBtn').disabled);
}

/** All three questions, landing on the review screen. */
export async function completeQuestions(page, answers = ['We worked on scales and Let It Be.', 'The chorus went well; the F chord is still tricky.', 'Slow F to C changes after school.']) {
    for (let i = 0; i < 3; i++) {
        await answer(page, answers[i]);
        await page.click('#mainActionBtn');
    }
    await page.locator('#processed').waitFor({ state: 'visible' });
}

export const buttonTop = async (page) => (await page.locator('#mainActionBtn').boundingBox()).y;
