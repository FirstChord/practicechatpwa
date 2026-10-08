// Scripted Practice Chat walkthrough → GIF (email) + MP4 (dashboard).
//
//   npm run demo:record        → tools/demo-recording/out/
//
// Needs Google Chrome installed and ffmpeg on the PATH. A Chrome window opens
// off-screen for about a minute: headless Chrome only screencasts at CSS
// pixels, so the headed window is what makes the output Retina-sharp.
//
// Safety: Practice Chat is served locally, the dashboard base URL points back at
// the same local server, and every /api/** call is answered here with fake data.
// Any other outbound request (except Google Fonts) is aborted. The microphone
// client is swapped for a fake that "hears" a canned transcript. Nothing can
// reach MMS, the dashboard, OpenAI or a parent's inbox, and the only student
// on screen is the made-up "Test Student".
//
// Fragile by nature: it drives the real UI by element id, and the
// fake mic replaces asr-client.js wholesale. If app.js starts importing more
// from asr-client.js, add it to FAKE_ASR below.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(process.argv[2] || path.join(HERE, '../../public'));
const OUT_DIR = path.resolve(process.argv[3] || path.join(HERE, 'out'));

const PORT = 8765;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 520, height: 860 };
const SCALE = 2;

const STUDENT = { id: 'sdt_DEMO01', name: 'Test Student', tutor: 'Demo Tutor' };

// One entry per question. Each turn is shown as a chat bubble while
// "recording", and the turns joined together are what the fake mic "hears".
const CONVERSATIONS = [
    [
        ['Tutor', 'We warmed up with the C major scale, then worked on the verse and chorus of Let It Be.']
    ],
    [
        ['Tutor', 'What do you think went well today?'],
        ['Student', 'The chorus. Switching from C to G is way easier now.'],
        ['Tutor', 'Agreed! And what still feels tricky?'],
        ['Student', 'The F chord. My fingers keep slipping.']
    ],
    [
        ['Tutor', 'What do you think would be good to practise this week?'],
        ['Student', 'Slow changes between F and C?'],
        ['Tutor', 'Perfect. Ten minutes a day, then play along with Let It Be once.']
    ]
];
const TRANSCRIPTS = CONVERSATIONS.map((turns) => turns.map(([, text]) => text).join(' '));

const lessonStart = new Date();
lessonStart.setHours(16, 0, 0, 0);
const lastWeek = new Date(lessonStart.getTime() - 7 * 86400000);
const attendance = { attendanceId: 'att_demo_1', eventStartDate: lessonStart.toISOString(), attendanceStatus: 'Unrecorded' };

const API = {
    'music-context': () => ({
        instrument: 'Guitar',
        songTitles: ['Let It Be', 'Wonderwall'],
        songs: [
            { songId: 'song_let_it_be', title: 'Let It Be', status: 'current' },
            { songId: 'song_wonderwall', title: 'Wonderwall', status: 'current' }
        ],
        catalogueSongs: [
            { songId: 'song_let_it_be', title: 'Let It Be', artist: 'The Beatles', contentType: 'song' },
            { songId: 'song_wonderwall', title: 'Wonderwall', artist: 'Oasis', contentType: 'song' }
        ]
    }),
    'mms-test': (body) => body.mode === 'execute'
        ? {
            targetAttendance: { ...attendance, attendanceStatus: 'Present' },
            candidateAttendances: [attendance],
            recipients: [{ name: 'Parent', email: 'parent@example.com' }],
            practiceNoteLog: { ok: true, noteId: 'note_demo' },
            emailNotes: { ok: true },
            practiceNoteEmail: { toEmail: 'parent@example.com' }
        }
        : {
            targetAttendance: attendance,
            candidateAttendances: [attendance, { attendanceId: 'att_demo_0', eventStartDate: lastWeek.toISOString(), attendanceStatus: 'Present' }],
            recipients: [{ name: 'Parent', email: 'parent@example.com' }],
            targetSelection: { label: 'Today’s lesson.' }
        },
    group: () => ({ isGroup: false }),
    'practice-chat-sessions': () => ({ ok: true }),
    'practice-notes': () => ({ ok: true, noteId: 'note_demo' })
};

const FAKE_ASR = `
const transcripts = ${JSON.stringify(TRANSCRIPTS)};
let turn = 0;
export const DEFAULT_ASR_MODEL = 'whisper-1';
export function resolveAsrModel() { return DEFAULT_ASR_MODEL; }
export class WhisperASRClient {
    constructor() { this.onPartialTranscript = null; this.onFinalTranscript = null; this.onError = null; }
    async start() { window.__demo?.mic(true); }
    async stop() {
        window.__demo?.mic(false);
        this.onPartialTranscript?.('Tidying up your notes…');
        await new Promise((r) => setTimeout(r, 900));
        const text = transcripts[turn++ % transcripts.length];
        this.onFinalTranscript?.(text);
        return text;
    }
}
`;

// Caption bar + fake cursor, drawn on top of the real app.
const OVERLAY = `
(() => {
  const css = \`
    #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
      transform:translate(300px,700px);transition:transform .55s cubic-bezier(.45,0,.2,1);}
    #demo-cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    .demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;
      pointer-events:none;background:rgba(62,141,88,.35);animation:demo-ripple .5s ease-out forwards}
    @keyframes demo-ripple{from{transform:scale(.2);opacity:1}to{transform:scale(1.4);opacity:0}}
    #demo-caption{position:fixed;left:0;right:0;margin:0 auto;bottom:20px;width:max-content;max-width:90%;
      transform:translateY(12px);opacity:0;z-index:2147483645;display:flex;align-items:center;gap:10px;
      padding:11px 20px 11px 12px;border-radius:999px;background:rgba(24,32,28,.93);color:#fff;
      font:600 16px/1.3 'Open Sans',system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);
      transition:opacity .3s ease, transform .3s ease;pointer-events:none}
    #demo-caption.show{opacity:1;transform:translateY(0)}
    #demo-caption .demo-step{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#3E8D58;font-size:13px}
    #demo-chat{position:fixed;top:0;left:0;right:0;height:186px;box-sizing:border-box;padding:16px 16px 0;z-index:2147483644;display:flex;flex-direction:column;justify-content:center;gap:8px;pointer-events:none;
      background:rgba(236,242,250,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:0;transition:opacity .3s}
    #demo-chat.on{opacity:1}
    .demo-bubble{max-width:78%;padding:8px 13px 9px;border-radius:16px;font:500 14px/1.35 'Open Sans',system-ui,sans-serif;
      box-shadow:0 6px 18px rgba(0,0,0,.14);animation:demo-pop .3s cubic-bezier(.2,.9,.3,1.2) both;transition:opacity .3s}
    .demo-bubble b{display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;opacity:.7;margin-bottom:1px}
    .demo-bubble.tutor{align-self:flex-start;background:#fff;color:#1d2a22;border-bottom-left-radius:4px}
    .demo-bubble.student{align-self:flex-end;background:#3E8D58;color:#fff;border-bottom-right-radius:4px}
    @keyframes demo-pop{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
  \`;
  const mount = () => {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const caption = document.createElement('div'); caption.id = 'demo-caption';
    const chat = document.createElement('div'); chat.id = 'demo-chat';
    document.body.append(cursor, caption, chat);
    window.__demo = {
      move(x, y) { cursor.style.transform = \`translate(\${x - 3}px,\${y - 2}px)\`; },
      ripple(x, y) { const r = document.createElement('div'); r.className = 'demo-ripple';
        r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); },
      caption(text, step) {
        if (!text) { caption.classList.remove('show'); return; }
        caption.innerHTML = (step ? '<span class="demo-step">' + step + '</span>' : '') + text;
        caption.classList.add('show');
      },
      mic() {},
      // Only the latest two turns fit over the header.
      say(who, text) {
        const b = document.createElement('div'); b.className = 'demo-bubble ' + who.toLowerCase();
        b.innerHTML = '<b>' + who + '</b>' + text; chat.appendChild(b); chat.classList.add('on');
        while (chat.children.length > 2) chat.firstElementChild.remove();
      },
      clearChat() { chat.classList.remove('on'); setTimeout(() => chat.replaceChildren(), 300); }
    };
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount) : mount();
})();
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));


async function main() {
    rmSync(OUT_DIR, { recursive: true, force: true });
    const frameDir = path.join(OUT_DIR, 'frames');
    mkdirSync(frameDir, { recursive: true });

    const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', PUBLIC_DIR], { stdio: 'ignore' });
    try {
        await wait(800);
        await record(frameDir);
    } finally {
        server.kill();
    }
    encode(frameDir);
    console.log(readdirSync(OUT_DIR).filter((f) => f !== 'frames').join('\n'));
}

async function record(frameDir) {
    // Headed, parked off-screen: headless Chrome screencasts at CSS pixels only.
    const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=-2400,0'] });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, serviceWorkers: 'block' });

    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGIN && url.pathname.startsWith('/api/')) {
            const key = url.pathname.split('/').filter(Boolean).pop();
            const body = route.request().postDataJSON?.() || {};
            return route.fulfill({ json: API[key] ? API[key](body) : { ok: true } });
        }
        if (url.origin === ORIGIN && url.pathname === '/src/asr-client.js') {
            return route.fulfill({ contentType: 'text/javascript', body: FAKE_ASR });
        }
        if (url.origin === ORIGIN || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
            return route.continue();
        }
        console.warn('blocked', url.href);
        return route.abort();
    });
    await context.addInitScript(OVERLAY);

    const page = await context.newPage();
    const params = new URLSearchParams({
        studentId: STUDENT.id, studentName: STUDENT.name, tutor: STUDENT.tutor, dashboardBaseUrl: ORIGIN
    });
    await page.goto(`${ORIGIN}/?${params}`);
    await page.waitForLoadState('networkidle');
    await wait(300);

    // Chrome's own screencast, at device pixels. Frames only arrive when the
    // page repaints, so each one keeps its timestamp and becomes a duration.
    const frames = [];
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
        writeFileSync(path.join(frameDir, file), Buffer.from(data, 'base64'));
        frames.push({ file, t: metadata.timestamp });
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEWPORT.width * SCALE, maxHeight: VIEWPORT.height * SCALE });

    const caption = (text, step) => page.evaluate(([t, s]) => window.__demo.caption(t, s), [text, step]);
    const pointAt = async (selector) => {
        const el = page.locator(selector).first();
        try {
            await el.waitFor({ state: 'visible', timeout: 8000 });
        } catch (error) {
            await page.screenshot({ path: path.join(OUT_DIR, 'failed-step.png') });
            throw new Error(`demo step never became visible: ${selector} (see out/failed-step.png)`);
        }
        await el.evaluate((node) => node.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await wait(500);
        const box = await el.boundingBox();
        const x = box.x + Math.min(box.width / 2, 60);
        const y = box.y + box.height / 2;
        await page.evaluate(([px, py]) => window.__demo.move(px, py), [x, y]);
        await wait(600);
        return { el, x, y };
    };
    const click = async (selector, { pause = 400 } = {}) => {
        const { el, x, y } = await pointAt(selector);
        await page.evaluate(([px, py]) => window.__demo.ripple(px, py), [x, y]);
        await el.click();
        await wait(pause);
    };

    // Press record, let the conversation play out as bubbles, press stop.
    const recordAnswer = async (question, { beat = 1250 } = {}) => {
        await click('#mainActionBtn', { pause: 300 });
        for (const [who, text] of CONVERSATIONS[question]) {
            await page.evaluate(([w, t]) => window.__demo.say(w, t), [who, text]);
            await wait(Math.max(beat, text.length * 24));
        }
        await click('#mainActionBtn', { pause: 0 });
        await page.evaluate(() => window.__demo.clearChat());
        await wait(1300);
    };

    // Put the caret just before `phrase` in the note, point at it, and type.
    const labelTurn = async (phrase, name, { newLine = true } = {}) => {
        const point = await page.evaluate((target) => {
            const root = document.getElementById('processed');
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const index = node.data.indexOf(target);
                if (index < 0) continue;
                const range = document.createRange();
                range.setStart(node, index);
                range.collapse(true);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                const rect = range.getBoundingClientRect();
                return { x: rect.left, y: rect.top + rect.height / 2 };
            }
            throw new Error(`phrase not in note: ${target}`);
        }, phrase);
        await page.evaluate(([x, y]) => window.__demo.move(x, y), [point.x, point.y]);
        await wait(450);
        if (newLine) await page.keyboard.press('Enter');
        await page.keyboard.type(`${name}: `, { delay: 35 });
        await wait(250);
    };

    // The three questions
    await wait(400);
    await caption('Three quick questions about the lesson', '1');
    await wait(1500);
    await caption('Press record and say what you covered', '1');
    await recordAnswer(0, { beat: 2200 });

    await click('#mainActionBtn', { pause: 200 });
    await caption('Then ask the student how it went', '2');
    await recordAnswer(1);
    await caption('It gives them a say in their own learning', '2');
    await wait(1800);

    await click('#mainActionBtn', { pause: 200 });
    await caption('Ask what they think they should practise', '3');
    await recordAnswer(2);

    // Review
    await caption('Your notes are written up for you', '✎');
    await click('#mainActionBtn', { pause: 1700 });
    await caption('Add names to turn it into a dialogue', '✎');
    await pointAt('#processed');
    await page.locator('#processed').click();
    for (const question of [1, 2]) {
        for (const [index, [who, text]] of CONVERSATIONS[question].entries()) {
            await labelTurn(text.split(' ').slice(0, 5).join(' '), who, { newLine: index > 0 });
        }
    }
    await wait(1000);
    await caption('Tick the songs you worked on', '♪');
    await click('#songSuggestions input', { pause: 900 });

    // Finish
    await caption('Check the lesson date', '✓');
    await click('#mmsDateConfirm', { pause: 900 });
    await caption('One button saves it and emails home', '✓');
    await click('#mmsExecuteBtn', { pause: 700 });
    await click('#sendRecipientConfirm', { pause: 400 });
    await click('.action-confirm-primary', { pause: 600 });
    await caption('Done', '✓');
    await pointAt('#mmsPreview');
    await wait(2600);

    await cdp.send('Page.stopScreencast');
    frames.push({ file: frames.at(-1).file, t: Date.now() / 1000 });
    await browser.close();

    const list = frames.slice(0, -1).map((frame, i) =>
        `file '${frame.file}'\nduration ${Math.max(frames[i + 1].t - frame.t, 0.001).toFixed(4)}`);
    list.push(`file '${frames.at(-1).file}'`);
    writeFileSync(path.join(frameDir, 'frames.txt'), list.join('\n') + '\n');
}

// The GIF is cut from the finished MP4, not the raw frames: straight from the
// variable-rate JPEG frames, ffmpeg once produced a 56MB GIF that was 15s short.
function encode(frameDir) {
    const mp4 = path.join(OUT_DIR, 'practice-chat-demo.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frameDir, 'frames.txt'),
        '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4,
        '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
        path.join(OUT_DIR, 'practice-chat-demo.gif')]);
}

main().catch((error) => { console.error(error); process.exit(1); });
