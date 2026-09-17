// Practice Chat - Main Application
// Handles recording, transcription, and UI with three-question flow

import { resolveAsrModel, WhisperASRClient } from './asr-client.js?v=20260917-two-parent-households';
import { checkNoteSafety, enhancedCleanupSpeechText } from './text-processor.js?v=20260917-two-parent-households';
import {
    buildPracticeNoteSnapshot,
    executePracticeNoteGroup,
    executePracticeNoteMmsTestWrite,
    fetchPracticeChatMusicContext,
    getPracticeChatContext,
    isLocalMmsWriteTestAvailable,
    previewPracticeNoteGroup,
    previewPracticeNoteMmsTestWrite,
    savePracticeChatSession,
    savePracticeNoteSnapshot,
    suggestPracticeNoteSongs
} from './practice-note-sync.js?v=20260917-two-parent-households';
import {
    buildSessionPayload,
    createSession,
    markPhase,
    markStep,
    measureEdit,
    recordAsrError,
    recordRating,
    recordReRecord,
    recordSafety,
    recordSkip,
    recordSongs,
    recordingStarted,
    recordingStopped,
    shouldFlushOnHide,
    shouldPromptForRating,
    transcriptReceived
} from './session-telemetry.js?v=20260917-two-parent-households';
import {
    noteMarkupToHtml,
    rawNoteText,
    renderNoteMarkup,
    serialiseNoteMarkup,
    stripNoteMarkers,
    toggleBulletLines
} from './note-markup.js?v=20260917-two-parent-households';

const PRACTICE_CHAT_BUILD = '20260917-two-parent-households';

const QUESTIONS = [
    "What did we do in the lesson?",
    "What went well or what was challenging?",
    "What would be good practice over the week? (and how!)"
];

const QUESTION_LABELS = [
    "[What we did]",
    "[Progress & Challenges]",
    "[Practice Goals]"
];

const NOTE_PLACEHOLDER = 'Processed notes will appear here...';

// So a tutor sees at most one rating card a day however many lessons they teach.
const RATING_PROMPT_DATE_KEY = 'practiceChatRatingPromptedOn';
// "Stop asking me" is permanent and honoured without argument. A prompt someone
// has opted out of that reappears next week is worse than never asking.
const RATING_OPT_OUT_KEY = 'practiceChatRatingOptOut';

class PracticeChatApp {
    constructor() {
        this.asrClient = null;
        this.isRecording = false;
        this.currentQuestionIndex = 0;
        this.questionAnswers = ['', '', '']; // Store answers for each question
        this.currentTranscript = '';
        this.context = getPracticeChatContext(window.location.search);
        this.asrModel = resolveAsrModel(window.location.search);
        // Songs and instrument for this student, used to tell the model what
        // words to expect. Loaded once per session, in the background.
        this.transcriptionPrompt = '';
        this.availableSongs = [];
        this.catalogueSongs = [];
        this.suggestedSongs = [];
        this.selectedSongIds = new Set();
        this.unlistedSongTitles = [];
        this.songSelectionLocked = false;
        this.lastDashboardSavedText = '';
        this.dashboardSaveInFlight = false;
        this.mmsTestInFlight = false;
        this.lastMmsPreview = null;
        this.selectedMmsAttendanceId = '';
        this.selectedMmsAttendanceStatus = 'Present';
        // Who else is in this lesson, answered by the server from the MMS event.
        this.lessonGroup = null;
        this.groupDeliveryChosen = true;
        this.mmsDateConfirmed = false;
        this.mmsWorkflowComplete = false;
        this.mmsExecuteButtonLabel = '';

        // Six-week evaluation telemetry. Held in memory and sent three times as
        // the session progresses; the note text it measures never travels with
        // it. Only exists when the dashboard supplied context — a bookmarked or
        // installed PWA records nothing at all.
        this.session = this.context.studentId && this.context.dashboardBaseUrl
            ? createSession({
                context: this.context,
                asrModel: this.asrModel,
                buildVersion: PRACTICE_CHAT_BUILD
            })
            : null;
        // The text the app produced, kept so an edit can be measured against it.
        this.generatedNoteText = '';
        // The phase the server has actually been told about.
        this.sentPhase = '';

        this.initializeElements();
        this.bindEvents();
        this.updateQuestionDisplay();
        this.configureMmsTestPanel();
        this.loadTranscriptionPrompt();
        this.sendSessionTelemetry();
        this.bindSessionFlush();
    }

    /**
     * Fire-and-forget. Never awaited by anything on the tutor's path, never
     * throws, never shows an error: measuring the ritual must not be able to
     * interrupt it. A failed send leaves a gap in the evaluation, which is the
     * right place to feel it.
     */
    sendSessionTelemetry({ keepalive = false } = {}) {
        if (!this.session) return;
        try {
            const payload = buildSessionPayload(this.session);
            // Remember what the server has been told, so the flush below can
            // tell "nothing new to say" from "the last thing never got sent".
            this.sentPhase = payload.phase;
            savePracticeChatSession({
                dashboardBaseUrl: this.context.dashboardBaseUrl,
                payload,
                practiceChatSecret: this.context.practiceChatSecret,
                keepalive
            });
        } catch (error) {
            console.warn('Session telemetry skipped:', error);
        }
    }

    /**
     * A last write when the panel closes mid-ritual.
     *
     * Enrichment, not the signal. The dashboard already knows a session was
     * abandoned from the phase it never reached; this only adds *where* it
     * stopped. `pagehide` in an iframe is unreliable by nature, which is exactly
     * why abandonment is never inferred from its absence.
     */
    bindSessionFlush() {
        if (!this.session) return;
        window.addEventListener('pagehide', () => {
            // Flush whenever the server is behind, not merely when the ritual is
            // unfinished. Those came apart in the rating case: `finishSession`
            // sets phase to `finished` and then *holds* the send so the tutor's
            // score can ride on the same row. A tutor who closed the panel
            // without answering therefore left a completed lesson recorded as
            // abandoned-at-review — and only ever for sampled sessions, so it
            // would have quietly biased the completion rate against exactly the
            // sessions carrying the ratings.
            if (!shouldFlushOnHide({ sentPhase: this.sentPhase, phase: this.session.phase })) return;
            this.sendSessionTelemetry({ keepalive: true });
        });
    }

    /**
     * Load the student's songs and instrument in the background.
     *
     * Silent on failure: no prompt is a slightly worse transcription, not a
     * broken lesson, and there is nothing a tutor could do about it mid-session.
     */
    loadTranscriptionPrompt() {
        fetchPracticeChatMusicContext({
            dashboardBaseUrl: this.context.dashboardBaseUrl,
            studentId: this.context.studentId,
            practiceChatSecret: this.context.practiceChatSecret
        }).then((context) => {
            this.transcriptionPrompt = context.prompt || '';
            this.availableSongs = context.songs || [];
            this.catalogueSongs = context.catalogueSongs || [];
            this.refreshSongSuggestions();
            this.renderSongChoices();
            if (context.songTitles?.length) {
                console.log(`🎵 Transcription context: ${context.instrument || 'unknown instrument'}, ${context.songTitles.length} song(s)`);
            }
        }).catch((error) => {
            console.warn('Music context unavailable; transcribing without a prompt:', error);
        });
    }

    initializeElements() {
        // Question elements
        this.questionNumberEl = document.getElementById('questionNumber');
        this.questionTextEl = document.getElementById('questionText');
        this.questionProgressEl = document.getElementById('questionProgress');

        // Main action button
        this.mainActionBtn = document.getElementById('mainActionBtn');
        this.mainActionText = document.getElementById('mainActionText');

        // Navigation buttons
        this.skipBtn = document.getElementById('skipBtn');
        this.backBtn = document.getElementById('backBtn');
        this.typeNotesBtn = document.getElementById('typeNotesBtn');

        // Answer display
        this.currentAnswerEl = document.getElementById('currentAnswer');

        // Output elements
        this.copyBtn = document.getElementById('copyBtn');
        this.newBtn = document.getElementById('newBtn');
        this.statusEl = document.getElementById('status');
        this.processedEl = document.getElementById('processed');
        this.outputSection = document.getElementById('outputSection');
        this.songLinkPanel = document.getElementById('songLinkPanel');
        this.songSuggestionSection = document.getElementById('songSuggestionSection');
        this.songSuggestionsEl = document.getElementById('songSuggestions');
        this.songShelfSection = document.getElementById('songShelfSection');
        this.songChoicesEl = document.getElementById('songChoices');
        this.songSearchInput = document.getElementById('songSearchInput');
        this.songSearchResultsEl = document.getElementById('songSearchResults');
        this.songMoreSummary = document.getElementById('songMoreSummary');
        this.unlistedSongInput = document.getElementById('unlistedSongInput');
        this.addUnlistedSongBtn = document.getElementById('addUnlistedSongBtn');
        this.unlistedSongChoicesEl = document.getElementById('unlistedSongChoices');
        // Evaluation rating card. Absent from the DOM for everyone not in the
        // trial only in the sense that it stays hidden — the markup is inert.
        this.ratingCard = document.getElementById('ratingCard');
        this.ratingCommentInput = document.getElementById('ratingComment');
        this.mmsTestPanel = document.getElementById('mmsTestPanel');
        this.mmsExecuteBtn = document.getElementById('mmsExecuteBtn');
        this.mmsPreviewEl = document.getElementById('mmsPreview');
        this.attendanceStatusInputs = document.querySelectorAll('input[name="attendanceStatus"]');

        // Question section
        this.questionSection = document.getElementById('questionSection');

        // Formatting toolbar
        this.noteToolbar = document.querySelector('.note-toolbar');

        // Button state
        this.buttonState = 'start'; // start, stop, next, finish
    }

    // The note as it goes on the wire: emphasis expressed as markers, never as
    // HTML. Everything that saves, sends or hashes the note reads this.
    readNoteMarkup() {
        return serialiseNoteMarkup(this.processedEl);
    }

    // The note as prose. Song matching compares titles exactly and counts
    // characters backwards to find its cue, and the safety check works on word
    // boundaries — a stray marker makes either fail silently, so anything that
    // *analyses* the note reads this instead.
    readNotePlainText() {
        return stripNoteMarkers(this.readNoteMarkup());
    }

    isNotePlaceholder() {
        return this.readNoteMarkup().trim() === NOTE_PLACEHOLDER;
    }

    setNoteContent(text = '') {
        this.processedEl.innerHTML = renderNoteMarkup(text);
        this.syncToolbarState();
    }

    bindNoteToolbar() {
        if (!this.noteToolbar) return;

        // mousedown, not click: the default would blur the editor and collapse
        // the selection before the command could act on it.
        this.noteToolbar.addEventListener('mousedown', (event) => {
            const button = event.target.closest('[data-format]');
            if (!button) return;
            event.preventDefault();
            this.applyNoteFormat(button.dataset.format);
        });

        // Cmd/Ctrl+B and +I already work natively inside a contenteditable; this
        // only keeps the buttons showing the truth afterwards.
        this.processedEl.addEventListener('keyup', () => this.syncToolbarState());
        this.processedEl.addEventListener('mouseup', () => this.syncToolbarState());
        this.processedEl.addEventListener('focus', () => this.syncToolbarState());

        // Paste as plain text. The serialiser only understands its own handful
        // of tags, so pasted markup would be silently flattened anyway — doing it
        // here means the tutor sees immediately what they are actually getting.
        this.processedEl.addEventListener('paste', (event) => {
            const text = event.clipboardData?.getData('text/plain');
            if (text === undefined) return;
            event.preventDefault();
            document.execCommand('insertText', false, text);
        });
    }

    applyNoteFormat(format) {
        this.processedEl.focus();

        if (format === 'bullet') {
            this.toggleSelectedLinesAsBullets();
        } else {
            // styleWithCSS off keeps the result as <b>/<i> tags rather than
            // inline styles, which is what the serialiser reads most reliably.
            document.execCommand('styleWithCSS', false, false);
            document.execCommand(format, false, null);
        }

        this.processedEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Bullets are literal "- " text, so this rewrites whole lines rather than
    // asking execCommand for a <ul> the wire format has no way to carry.
    toggleSelectedLinesAsBullets() {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;

        // Measured in raw space on both sides. readNoteMarkup() trims and
        // collapses blank runs, so using it here would shorten every prefix and
        // shift the line index — which bulleted the heading above the selection.
        const lines = rawNoteText(this.processedEl).split('\n');
        const range = selection.getRangeAt(0);

        const lineOf = (node, offset) => {
            const probe = document.createRange();
            probe.setStart(this.processedEl, 0);
            probe.setEnd(node, offset);
            const holder = document.createElement('div');
            holder.appendChild(probe.cloneContents());
            return rawNoteText(holder).split('\n').length - 1;
        };

        const startLine = lineOf(range.startContainer, range.startOffset);
        const endLine = lineOf(range.endContainer, range.endOffset);

        const target = lines.slice(startLine, endLine + 1);
        const { lines: toggled } = toggleBulletLines(target);
        lines.splice(startLine, target.length, ...toggled);

        this.setNoteContent(lines.join('\n'));
    }

    syncToolbarState() {
        if (!this.noteToolbar) return;
        for (const button of this.noteToolbar.querySelectorAll('[data-format]')) {
            const format = button.dataset.format;
            let active = false;
            try {
                active = format === 'bullet'
                    ? /^[ \t]*[-*][ \t]+/.test(this.currentNoteLine())
                    : document.queryCommandState(format);
            } catch {
                active = false;
            }
            button.setAttribute('aria-pressed', String(active));
        }
    }

    currentNoteLine() {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !this.processedEl.contains(selection.anchorNode)) return '';
        const probe = document.createRange();
        probe.setStart(this.processedEl, 0);
        probe.setEnd(selection.anchorNode, selection.anchorOffset);
        const holder = document.createElement('div');
        holder.appendChild(probe.cloneContents());
        // Raw on both sides, for the same reason as the bullet toggle.
        const lineIndex = rawNoteText(holder).split('\n').length - 1;
        return rawNoteText(this.processedEl).split('\n')[lineIndex] || '';
    }

    // Copy the note twice over: markers for anything plain, real HTML for MMS's
    // rich editor. Without the HTML flavour the legacy paste-into-MMS flow would
    // show the tutor literal asterisks.
    async writeNoteToClipboard(text) {
        if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
            try {
                await navigator.clipboard.write([new ClipboardItem({
                    'text/plain': new Blob([stripNoteMarkers(text)], { type: 'text/plain' }),
                    'text/html': new Blob([noteMarkupToHtml(text)], { type: 'text/html' })
                })]);
                return;
            } catch (error) {
                // Older WebKit rejects Blob sources; the plain path still works.
                console.warn('Rich clipboard unavailable, copying plain text:', error);
            }
        }
        await navigator.clipboard.writeText(stripNoteMarkers(text));
    }

    bindEvents() {
        this.mainActionBtn.addEventListener('click', () => this.handleMainAction());
        this.skipBtn.addEventListener('click', () => this.skipQuestion());
        this.backBtn.addEventListener('click', () => this.previousQuestion());
        this.typeNotesBtn?.addEventListener('click', () => this.startTypedNotes());
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.newBtn.addEventListener('click', () => this.resetForNew());
        this.processedEl.addEventListener('input', () => {
            this.refreshSongSuggestions();
            this.syncToolbarState();
        });
        this.bindNoteToolbar();
        // A change listener, not a delegated click: clicking a label fires a
        // click on the label AND a synthesised one on the input it wraps, so
        // click delegation would toggle twice and appear to do nothing.
        this.songLinkPanel?.addEventListener('change', (event) => {
            const input = event.target.closest('input[data-song-id]');
            if (!input || this.songSelectionLocked) return;
            const songId = input.dataset.songId;
            if (!input.checked) {
                this.selectedSongIds.delete(songId);
            } else if (this.selectedSongIds.size >= 12) {
                // The browser has already ticked the box, so refuse visibly.
                input.checked = false;
                this.showStatus('Select no more than twelve songs for one note.', 'warning');
                return;
            } else {
                this.selectedSongIds.add(songId);
            }
            this.syncSongSelectionState();
        });
        this.songLinkPanel?.addEventListener('click', (event) => {
            const removeButton = event.target.closest('[data-remove-unlisted]');
            if (removeButton && !this.songSelectionLocked) {
                this.unlistedSongTitles = this.unlistedSongTitles
                    .filter((title) => title !== removeButton.dataset.removeUnlisted);
                this.renderSongChoices();
            }
        });
        this.songSearchInput?.addEventListener('input', () => this.renderSongSearchResults());
        this.addUnlistedSongBtn?.addEventListener('click', () => this.addUnlistedSong());
        this.unlistedSongInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.addUnlistedSong();
            }
        });
        // Delegated: the five score buttons, Skip and the opt-out all resolve to
        // one answer, and only their data attributes differ.
        this.ratingCard?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-rating-action]');
            if (!button) return;
            const action = button.dataset.ratingAction;
            this.answerRating({
                accuracy: action === 'score' ? Number(button.dataset.ratingScore) : '',
                optOut: action === 'opt-out'
            });
        });
        if (this.mmsExecuteBtn) {
            this.mmsExecuteButtonLabel = this.mmsExecuteBtn.textContent;
            this.mmsExecuteBtn.addEventListener('click', () => this.executeMmsTestWrite());
        }
        if (this.mmsPreviewEl) {
            this.mmsPreviewEl.addEventListener('change', (event) => this.handleMmsPreviewChange(event));
        }
        this.attendanceStatusInputs.forEach((input) => {
            input.addEventListener('change', (event) => this.handleAttendanceStatusChange(event));
        });
    }

    configureMmsTestPanel() {
        if (!this.mmsTestPanel) return;
        if (isLocalMmsWriteTestAvailable({ context: this.context })) {
            this.mmsTestPanel.style.display = 'block';
            this.copyBtn.style.display = 'none';
        }
    }

    renderSongChoices() {
        if (!this.songLinkPanel || !this.songChoicesEl) return;
        this.songLinkPanel.hidden = this.availableSongs.length === 0 && this.catalogueSongs.length === 0;
        const suggestedIds = new Set(this.suggestedSongs.map((song) => song.songId));
        const otherShelfSongs = this.availableSongs.filter((song) => !suggestedIds.has(song.songId));

        if (this.songSuggestionSection && this.songSuggestionsEl) {
            this.songSuggestionSection.hidden = this.suggestedSongs.length === 0;
            this.songSuggestionsEl.innerHTML = this.suggestedSongs
                .map((song) => this.songChoiceRow(song, { suggested: true }))
                .join('');
        }
        if (this.songShelfSection) {
            this.songShelfSection.hidden = otherShelfSongs.length === 0;
        }
        this.songChoicesEl.innerHTML = otherShelfSongs
            .map((song) => this.songChoiceRow(song))
            .join('');
        if (this.unlistedSongChoicesEl) {
            this.unlistedSongChoicesEl.innerHTML = this.unlistedSongTitles.map((title) => `
                <span class="unlisted-song-choice">
                    ${this.escapeHtml(title)}
                    <button type="button" data-remove-unlisted="${this.escapeHtml(title)}" aria-label="Remove unlisted song ${this.escapeHtml(title)}"${this.songSelectionLocked ? ' disabled' : ''}>×</button>
                </span>
            `).join('');
        }
        if (this.songSearchInput) this.songSearchInput.disabled = this.songSelectionLocked;
        if (this.unlistedSongInput) this.unlistedSongInput.disabled = this.songSelectionLocked;
        if (this.addUnlistedSongBtn) this.addUnlistedSongBtn.disabled = this.songSelectionLocked;
        this.updateSongMoreSummary();
        this.renderSongSearchResults();
    }

    // A real checkbox in a full-width label, not a tinted pill.
    //
    // The pill had the affordance and almost no signifier: its border measured
    // 1.55:1 against its own fill where WCAG 1.4.11 asks 3:1 for a control
    // boundary, and its fill 1.07:1 against the card — so "you may press this"
    // was carried by something very close to invisible, and selection was
    // signalled by fill colour alone. An empty checkbox says the same thing
    // without being taught, and a tick is a shape as well as a colour.
    songChoiceRow(song, { suggested = false } = {}) {
        const selected = this.selectedSongIds.has(song.songId);
        // The hint earns its place only where it disambiguates. A suggested row
        // sits under "Suggested from your note" and a shelf row under "Other
        // songs on this student's shelf", so repeating either per row is noise;
        // a search result genuinely needs its artist ("Crazy" is two songs).
        const onShelf = song.onShelf
            || this.availableSongs.some((entry) => entry.songId === song.songId);
        const hint = suggested || onShelf ? '' : song.artist || '';
        return `<label class="song-choice${selected ? ' selected' : ''}">`
            + `<input type="checkbox" data-song-id="${this.escapeHtml(song.songId)}"${selected ? ' checked' : ''}${this.songSelectionLocked ? ' disabled' : ''}>`
            + `<span class="song-choice-title">${this.escapeHtml(song.title)}</span>`
            + (hint ? `<span class="song-choice-hint">${this.escapeHtml(hint)}</span>` : '')
            + '</label>';
    }

    // Selection changes update the boxes in place rather than re-rendering the
    // list: a full innerHTML swap would drop keyboard focus mid-tab, and the
    // same song can appear in both the shelf and the search results, so every
    // box for that id has to agree.
    syncSongSelectionState() {
        this.songLinkPanel?.querySelectorAll('input[data-song-id]').forEach((input) => {
            const isSelected = this.selectedSongIds.has(input.dataset.songId);
            input.checked = isSelected;
            input.disabled = this.songSelectionLocked;
            input.closest('.song-choice')?.classList.toggle('selected', isSelected);
        });
        this.updateSongMoreSummary();
    }

    updateSongMoreSummary() {
        if (!this.songMoreSummary) return;
        const visibleIds = new Set([...this.suggestedSongs, ...this.availableSongs].map((song) => song.songId));
        const extraCount = [...this.selectedSongIds].filter((songId) => !visibleIds.has(songId)).length
            + this.unlistedSongTitles.length;
        this.songMoreSummary.textContent = `Find another or add an unlisted song${extraCount ? ` · ${extraCount} added` : ''}`;
    }

    refreshSongSuggestions() {
        if (this.songSelectionLocked) return;
        this.suggestedSongs = suggestPracticeNoteSongs({
            noteText: this.readNotePlainText(),
            shelfSongs: this.availableSongs,
            catalogueSongs: this.catalogueSongs
        });
        this.renderSongChoices();
    }

    renderSongSearchResults() {
        if (!this.songSearchResultsEl) return;
        const query = `${this.songSearchInput?.value || ''}`.trim().toLowerCase();
        if (query.length < 2) {
            this.songSearchResultsEl.innerHTML = '';
            return;
        }
        const results = this.catalogueSongs
            .filter((song) => `${song.title} ${song.artist || ''}`.toLowerCase().includes(query))
            .sort((a, b) => {
                const aTitle = a.title.toLowerCase();
                const bTitle = b.title.toLowerCase();
                return Number(bTitle.startsWith(query)) - Number(aTitle.startsWith(query))
                    || a.title.localeCompare(b.title);
            })
            .slice(0, 8);
        this.songSearchResultsEl.innerHTML = results.length
            ? results.map((song) => this.songChoiceRow(song)).join('')
            : '<p class="song-search-empty">No catalogue match. Add it as unlisted below.</p>';
    }

    addUnlistedSong() {
        if (this.songSelectionLocked) return;
        const title = `${this.unlistedSongInput?.value || ''}`.trim();
        if (!title) return;
        if (title.length > 120) {
            this.showStatus('Keep an unlisted song title under 120 characters.', 'warning');
            return;
        }
        if (this.unlistedSongTitles.length >= 6) {
            this.showStatus('Add no more than six unlisted songs to one note.', 'warning');
            return;
        }
        if (!this.unlistedSongTitles.some((entry) => entry.toLowerCase() === title.toLowerCase())) {
            this.unlistedSongTitles.push(title);
        }
        this.unlistedSongInput.value = '';
        this.renderSongChoices();
    }

    getSelectedSongIds() {
        const validIds = new Set([...this.availableSongs, ...this.catalogueSongs].map((song) => song.songId));
        return [...this.selectedSongIds].filter((songId) => validIds.has(songId)).slice(0, 12);
    }

    resetMmsTestState() {
        this.lastMmsPreview = null;
        this.selectedMmsAttendanceId = '';
        this.selectedMmsAttendanceStatus = 'Present';
        // Who else is in this lesson, answered by the server from the MMS event.
        this.lessonGroup = null;
        this.groupDeliveryChosen = true;
        this.mmsDateConfirmed = false;
        this.mmsWorkflowComplete = false;
        this.attendanceStatusInputs.forEach((input) => {
            input.checked = input.value === 'Present';
        });
        if (this.mmsPreviewEl) {
            this.mmsPreviewEl.innerHTML = '';
            this.mmsPreviewEl.style.display = 'none';
        }
        if (this.mmsExecuteBtn) {
            this.mmsExecuteBtn.disabled = true;
            this.setMmsExecuteButtonBusy(false);
        }
        this.copyBtn.classList.remove('btn-secondary');
        this.copyBtn.classList.add('btn-success');
        this.copyBtn.innerHTML = '<span class="btn-icon">📋</span>Copy Notes';
        this.copyBtn.style.display = 'flex';
        if (isLocalMmsWriteTestAvailable({ context: this.context })) {
            this.copyBtn.style.display = 'none';
        }
        this.copyBtn.onclick = () => this.copyToClipboard();
    }

    startTypedNotes() {
        if (this.isRecording) {
            this.showStatus('Stop the recording before switching to typed notes.', 'warning');
            return;
        }

        this.questionAnswers = ['', '', ''];
        this.processedEl.textContent = this.buildTypedNoteTemplate();
        this.questionSection.style.display = 'none';
        this.outputSection.classList.add('show');
        this.showStatus('Type or paste the lesson notes, then check the lesson date.', 'info');

        // The typed fallback. Recorded as its own outcome rather than as an
        // abandoned recording: choosing to type is a workaround the tutor found,
        // and how often it happens is one of the things worth knowing.
        if (this.session) this.session.typedNotSpoken = true;
        // The template is what the app produced, so an edit is measured against
        // it — otherwise every typed note would read as "heavily edited".
        this.generatedNoteText = this.buildTypedNoteTemplate();
        markPhase(this.session, 'note_generated');
        this.sendSessionTelemetry();

        if (isLocalMmsWriteTestAvailable({ context: this.context })) {
            this.previewMmsTestWrite();
        }
    }

    buildTypedNoteTemplate() {
        return QUESTION_LABELS.map((label) => `${label}\n`).join('\n').trim();
    }

    handleMainAction() {
        switch (this.buttonState) {
            case 'start':
                this.startRecording();
                break;
            case 'stop':
                this.stopRecording();
                break;
            case 'next':
                this.nextQuestion();
                break;
            case 'finish':
                this.finishRecording();
                break;
        }
    }

    updateMainButton(state, text, icon) {
        this.buttonState = state;
        this.mainActionText.textContent = text;
        this.mainActionBtn.querySelector('.btn-icon').textContent = icon;

        // Update button color based on state
        this.mainActionBtn.className = 'btn btn-large';
        if (state === 'start' || state === 'stop') {
            this.mainActionBtn.classList.add('btn-primary');
        } else if (state === 'next') {
            this.mainActionBtn.classList.add('btn-success');
        } else if (state === 'finish') {
            this.mainActionBtn.classList.add('btn-success');
        }
    }

    updateQuestionDisplay() {
        const questionNum = this.currentQuestionIndex + 1;
        this.questionNumberEl.textContent = `Question ${questionNum} of 3`;
        this.questionTextEl.textContent = QUESTIONS[this.currentQuestionIndex];
        this.questionProgressEl.textContent = `${questionNum}/3`;

        // Update progress bar
        this.updateProgressBar();

        // Show/hide back button
        this.backBtn.style.display = this.currentQuestionIndex > 0 ? 'inline-block' : 'none';

        // Show current answer if exists
        const currentAnswer = this.questionAnswers[this.currentQuestionIndex];
        if (currentAnswer) {
            this.currentAnswerEl.textContent = currentAnswer;
            this.currentAnswerEl.style.display = 'block';

            // Button shows "Next Question" or "Finish"
            if (this.currentQuestionIndex < 2) {
                this.updateMainButton('next', 'Next Question', '→');
            } else {
                this.updateMainButton('finish', 'Finish', '✅');
            }
        } else {
            this.currentAnswerEl.style.display = 'none';
            // Button shows "Start Recording"
            this.updateMainButton('start', 'Start Recording', '🎤');
        }
    }

    updateProgressBar() {
        const progressItems = document.querySelectorAll('.progress-item');

        progressItems.forEach((item, index) => {
            // Remove all classes
            item.classList.remove('active', 'completed');

            // Add appropriate class
            if (index < this.currentQuestionIndex) {
                item.classList.add('completed');
            } else if (index === this.currentQuestionIndex) {
                item.classList.add('active');
            }
        });
    }

    async startRecording() {
        try {
            this.showStatus('Starting recording...', 'info');

            // Create new Whisper ASR client
            this.asrClient = new WhisperASRClient({
                model: this.asrModel,
                prompt: this.transcriptionPrompt
            });

            // Set up callbacks
            this.asrClient.onPartialTranscript = (text) => {
                // Show fun processing messages
                this.currentAnswerEl.textContent = text;
                this.currentAnswerEl.style.display = 'block';
            };

            this.asrClient.onFinalTranscript = (text) => {
                this.currentTranscript = text;
                this.processCurrentAnswer();
            };

            this.asrClient.onError = (error) => {
                recordAsrError(this.session, this.currentQuestionIndex);
                this.showStatus(`Error: ${error.message}`, 'error');
                this.isRecording = false;
                this.updateMainButton('start', 'Start Recording', '🎤');
                this.skipBtn.disabled = false;
            };

            // Start recording
            await this.asrClient.start();

            recordingStarted(this.session, this.currentQuestionIndex);
            this.isRecording = true;
            this.updateMainButton('stop', 'Stop Recording', '⏹️');
            this.skipBtn.disabled = true;
            this.backBtn.disabled = true;
            this.showStatus('🎤 Recording... Speak naturally', 'recording');

        } catch (error) {
            console.error('Failed to start recording:', error);
            // A microphone that will not open is a transcription failure the
            // tutor experiences as one, even though nothing reached the model.
            recordAsrError(this.session, this.currentQuestionIndex);
            this.showStatus(`Failed to start: ${error.message}`, 'error');
            this.isRecording = false;
            this.updateMainButton('start', 'Start Recording', '🎤');
        }
    }

    async stopRecording() {
        if (!this.asrClient) return;

        try {
            this.showStatus('Processing... (this may take a few seconds)', 'info');
            this.mainActionBtn.disabled = true;

            // Splits capture time from provider latency: a tutor talking for
            // ninety seconds and OpenAI taking nine are different findings.
            recordingStopped(this.session, this.currentQuestionIndex);

            // Stop recording and get transcript
            await this.asrClient.stop();

            this.isRecording = false;
            this.skipBtn.disabled = false;
            this.backBtn.disabled = false;
            this.mainActionBtn.disabled = false;
            this.showStatus('Answer recorded!', 'success');

        } catch (error) {
            console.error('Failed to process recording:', error);
            recordAsrError(this.session, this.currentQuestionIndex);
            this.showStatus(`Processing failed: ${error.message}`, 'error');
            this.isRecording = false;
            this.updateMainButton('start', 'Start Recording', '🎤');
            this.skipBtn.disabled = false;
            this.backBtn.disabled = false;
            this.mainActionBtn.disabled = false;
        } finally {
            this.asrClient = null;
        }
    }

    processCurrentAnswer() {
        // Length only — the transcript itself never leaves the browser.
        transcriptReceived(this.session, this.currentQuestionIndex, this.currentTranscript);

        if (!this.currentTranscript.trim()) {
            this.showStatus('No answer recorded', 'warning');
            this.updateMainButton('start', 'Start Recording', '🎤');
            return;
        }

        // Clean up the text
        const result = enhancedCleanupSpeechText(this.currentTranscript);

        // Store the answer for this question
        this.questionAnswers[this.currentQuestionIndex] = result.text;

        // Display the answer
        this.currentAnswerEl.textContent = result.text;
        this.currentAnswerEl.style.display = 'block';

        // Update main button to show Next or Finish
        if (this.currentQuestionIndex < 2) {
            this.updateMainButton('next', 'Next Question', '→');
        } else {
            this.updateMainButton('finish', 'Finish', '✅');
        }

        // Clear current transcript
        this.currentTranscript = '';

        console.log('Answer processed:', result.enhancements);
    }

    skipQuestion() {
        recordSkip(this.session, this.currentQuestionIndex);
        this.questionAnswers[this.currentQuestionIndex] = '';
        if (this.currentQuestionIndex < 2) {
            this.currentQuestionIndex++;
            markStep(this.session, this.currentQuestionIndex);
            this.updateQuestionDisplay();
        } else {
            this.finishRecording();
        }
    }

    previousQuestion() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            // Going back clears the answer so it can be re-recorded. Counted as
            // a correction, never as a failure — a tutor choosing to say it
            // better is not the tool breaking.
            recordReRecord(this.session, this.currentQuestionIndex);
            markStep(this.session, this.currentQuestionIndex);
            this.questionAnswers[this.currentQuestionIndex] = '';
            this.updateQuestionDisplay();
        }
    }

    nextQuestion() {
        if (this.currentQuestionIndex < 2) {
            this.currentQuestionIndex++;
            markStep(this.session, this.currentQuestionIndex);
            this.updateQuestionDisplay();
        }
    }

    finishRecording() {
        // Generate structured output
        this.generateStructuredOutput();

        // Hide question section
        this.questionSection.style.display = 'none';

        // Show output section
        this.outputSection.classList.add('show');

        this.showStatus('Lesson notes complete!', 'success');

        markPhase(this.session, 'note_generated');
        this.sendSessionTelemetry();

        if (isLocalMmsWriteTestAvailable({ context: this.context })) {
            this.previewMmsTestWrite();
        }
    }

    generateStructuredOutput() {
        let output = '';

        for (let i = 0; i < 3; i++) {
            if (this.questionAnswers[i]) {
                output += `${QUESTION_LABELS[i]}\n${this.questionAnswers[i]}\n\n`;
            }
        }

        this.processedEl.textContent = output.trim();
        this.refreshSongSuggestions();

        // Surface a mis-hearing early, while the tutor is still on the note.
        // The hard gate is at send time; this is just so it isn't a surprise.
        //
        // Deliberately says nothing specific. Tutors write these up with the
        // student sitting beside them, so the flagged word is never repeated on
        // screen — naming it would amplify exactly what we are trying to catch.
        // The word itself is already visible in the note, and the tutor knows
        // what a "word to check" means; the student reading over their shoulder
        // does not. Diagnosis goes to the console instead.
        const safety = checkNoteSafety(output);
        if (!safety.ok) {
            console.warn('Practice Chat safety flag:', safety.findings);
            this.showStatus('One word may need a check before sending.', 'info');
        }
        recordSafety(this.session, { flags: safety.ok ? 0 : safety.findings.length });

        // The baseline an edit is measured against: what the app produced,
        // before the tutor touched it.
        this.generatedNoteText = output.trim();

        // Save to localStorage
        this.saveNotes(output.trim());
    }

    /**
     * Ask the tutor to acknowledge flagged wording before it goes to a parent.
     * Flags never block outright — a false positive must not make a legitimate
     * note unsendable — but sending one requires a deliberate second tap.
     */
    confirmNoteSafety(findings = []) {
        // The flagged word is never shown. Where we have a confident guess at
        // what was actually said, the *safe* word is offered instead — that
        // points the tutor at the right place in the note without putting the
        // mis-heard one on a screen a child may be looking at. With no guess,
        // the prompt stays generic and the tutor re-reads.
        const suggestions = [...new Set(
            findings.map((finding) => finding.likelyMeant).filter(Boolean)
        )];
        const plural = findings.length > 1;
        const hint = suggestions.length
            ? `It may have been meant as ${suggestions
                .map((word) => `<strong>${this.escapeHtml(word)}</strong>`)
                .join(' or ')}.`
            : '';

        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'action-confirm-backdrop';
            backdrop.innerHTML = `
                <div class="action-confirm-card" role="dialog" aria-modal="true" aria-labelledby="safetyConfirmTitle">
                    <div class="action-confirm-kicker">Quick check</div>
                    <h2 id="safetyConfirmTitle">${plural ? 'A couple of words' : 'One word'} may have been misheard</h2>
                    <p class="action-confirm-copy">
                        Speech recognition sometimes mishears music words. ${hint}
                        Nothing has been changed for you — read the note through and
                        edit it if it is wrong.
                    </p>
                    <div class="action-confirm-actions">
                        <button type="button" class="btn action-confirm-secondary" data-confirm="cancel">Let me fix it</button>
                        <button type="button" class="btn btn-success action-confirm-primary" data-confirm="yes">Wording is correct</button>
                    </div>
                </div>
            `;

            const cleanup = (answer) => {
                document.removeEventListener('keydown', onKeyDown);
                backdrop.remove();
                resolve(answer);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') cleanup(false);
            };

            backdrop.addEventListener('click', (event) => {
                const action = event.target?.dataset?.confirm;
                if (action === 'yes') cleanup(true);
                if (action === 'cancel' || event.target === backdrop) cleanup(false);
            });
            document.addEventListener('keydown', onKeyDown);
            document.body.appendChild(backdrop);
            backdrop.querySelector('[data-confirm="cancel"]')?.focus();
        });
    }


    /**
     * The session reached an end. Captures what the tutor did to the note on
     * the way, then offers the rating card if this tutor is in the evaluation.
     *
     * Called from both finishing paths — the legacy copy flow and the Level 2
     * send — so "finished" means the same thing in the data whichever route a
     * tutor's student is on.
     */
    finishSession(outcome, { noteId = '' } = {}) {
        if (!this.session) return;

        measureEdit(this.session, {
            generated: this.generatedNoteText,
            final: this.readNotePlainText()
        });
        recordSongs(this.session, {
            songIds: this.getSelectedSongIds(),
            unlistedTitles: this.unlistedSongTitles
        });
        this.session.outcome = outcome;
        this.session.noteId = noteId;
        markPhase(this.session, 'finished');

        if (this.maybeShowRatingCard()) return;
        this.sendSessionTelemetry();
    }

    /**
     * Ask "did we get this note right?", if this tutor is in the evaluation and
     * this session was sampled.
     *
     * Framed as a bug report about software, not an assessment of a person: the
     * tutor is being asked whether the tool worked, which is a question they are
     * uniquely able to answer and one they have every reason to want answered.
     *
     * Returns true when the card is showing, so the caller leaves the send to
     * the answer handler and the rating lands on the same row.
     */
    maybeShowRatingCard() {
        let lastPromptedOn = '';
        try {
            if (localStorage.getItem(RATING_OPT_OUT_KEY) === 'true') return false;
            lastPromptedOn = localStorage.getItem(RATING_PROMPT_DATE_KEY) || '';
        } catch {
            // Private browsing. Fall through and let the sampling decide.
        }

        const show = shouldPromptForRating({
            session: this.session,
            evalPrompt: this.context.evalPrompt,
            evalSample: this.context.evalSample,
            lastPromptedOn
        });
        if (!show || !this.ratingCard) return false;

        this.session.ratingPrompted = true;
        try {
            localStorage.setItem(RATING_PROMPT_DATE_KEY, new Date().toISOString().slice(0, 10));
        } catch {
            // Without storage a tutor may be asked more than once a day. An
            // annoyance, not a reason to lose the answer.
        }
        this.ratingCard.hidden = false;
        return true;
    }

    /**
     * A score, or a skip. Both close the card and send.
     *
     * A skip is recorded rather than discarded: a prompt people decline is a
     * finding about the prompt, and without it the response rate is unknowable.
     */
    answerRating({ accuracy = '', optOut = false } = {}) {
        recordRating(this.session, {
            accuracy,
            comment: this.ratingCommentInput?.value || ''
        });

        if (optOut) {
            try {
                localStorage.setItem(RATING_OPT_OUT_KEY, 'true');
            } catch {
                // Nothing more we can do; the next session simply asks again.
            }
        }

        if (this.ratingCard) {
            this.ratingCard.hidden = true;
        }
        this.sendSessionTelemetry();
    }

    async copyToClipboard() {
        const text = this.readNoteMarkup();

        if (!text || this.isNotePlaceholder()) {
            this.showStatus('No content to copy', 'warning');
            return;
        }

        // The legacy path pastes into MMS by hand, so this warns rather than
        // gating — the tutor still sees the note before anything is sent.
        const safety = checkNoteSafety(this.readNotePlainText());

        try {
            await this.writeNoteToClipboard(text);
            const snapshot = await this.saveDashboardSnapshotForCurrentNote();
            this.finishSession('saved_snapshot', { noteId: snapshot?.noteId || '' });
            if (!safety.ok) {
                console.warn('Practice Chat safety flag:', safety.findings);
                this.showStatus('Copied — one word may need a check before pasting.', 'info');
            } else {
                this.showStatus(snapshot
                    ? '✅ Copied and saved to dashboard'
                    : '✅ Copied to clipboard!',
                'success');
            }

            if (!isLocalMmsWriteTestAvailable({ context: this.context })) {
                // No dashboard context: Practice Chat was opened from a bookmark
                // rather than the dashboard quick link, so there is no student to
                // write attendance for. The tutor copies the note and finishes in
                // MMS by hand. (The old comment called this the "Test Studenty
                // pilot" fallback, which stopped being true when Level 2 reached
                // real tutors.)
                this.copyBtn.innerHTML = '<span class="btn-icon">✅</span>Take Attendance';
                this.copyBtn.onclick = () => this.takeAttendance();
            }

            // Show attendance reminder
            const reminderEl = document.getElementById('attendanceReminder');
            if (reminderEl && !isLocalMmsWriteTestAvailable({ context: this.context })) {
                reminderEl.style.display = 'block';
            }
        } catch (error) {
            console.error('Copy failed:', error);
            this.showStatus('Failed to copy', 'error');
        }
    }

    async saveDashboardSnapshotForCurrentNote({ throwOnFailure = false } = {}) {
        if (this.dashboardSaveInFlight) {
            return null;
        }

        const text = this.readNoteMarkup();
        const snapshot = buildPracticeNoteSnapshot({
            context: this.context,
            noteText: text,
            songIds: this.getSelectedSongIds(),
            unlistedSongTitles: this.unlistedSongTitles
        });
        let savedSnapshot = null;

        this.dashboardSaveInFlight = true;
        this.copyBtn.disabled = true;
        try {
            if (snapshot && snapshot.rawNoteText !== this.lastDashboardSavedText) {
                const result = await savePracticeNoteSnapshot({
                    dashboardBaseUrl: this.context.dashboardBaseUrl,
                    snapshot: {
                        ...snapshot,
                        practiceChatSecret: this.context.practiceChatSecret
                    }
                });
                if (!result.skipped || result.noteId) {
                    savedSnapshot = snapshot;
                    this.lastDashboardSavedText = snapshot.rawNoteText;
                    this.songSelectionLocked = true;
                    this.renderSongChoices();
                }
                if (result.noteId) {
                    console.log('✅ Practice note snapshot saved:', result.noteId);
                }
            } else if (snapshot && snapshot.rawNoteText === this.lastDashboardSavedText) {
                savedSnapshot = snapshot;
            }
        } catch (error) {
            console.warn('Practice note snapshot save failed; continuing to MMS:', error);
            this.showStatus('Notes copied. Dashboard snapshot did not save, but you can still finish in MMS.', 'warning');
            if (throwOnFailure) {
                throw error;
            }
        } finally {
            this.dashboardSaveInFlight = false;
            this.copyBtn.disabled = false;
        }

        return savedSnapshot;
    }

    async takeAttendance() {
        const snapshot = await this.saveDashboardSnapshotForCurrentNote();
        if (snapshot || !this.dashboardSaveInFlight) {
            window.location.href = 'https://mymusicstaff.com';
        }
    }

    getCurrentNoteText() {
        const text = this.readNoteMarkup().trim();
        if (!text || this.isNotePlaceholder()) {
            this.showStatus('No lesson note to test', 'warning');
            return '';
        }
        return text;
    }

    formatMmsLessonDate(value) {
        const date = new Date(value || '');
        if (Number.isNaN(date.getTime())) {
            return value || 'Unknown date';
        }
        return date.toLocaleString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    formatDisplayDate(value) {
        const date = new Date(value || '');
        if (Number.isNaN(date.getTime())) {
            return value || '';
        }
        return date.toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    escapeHtml(value = '') {
        return `${value || ''}`
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    renderMmsPreview(preview) {
        if (!this.mmsPreviewEl) return;
        const isAbsentNoMakeup = this.selectedMmsAttendanceStatus === 'AbsentNoMakeup';
        const target = preview.targetAttendance || {};
        const candidates = preview.candidateAttendances || [];
        this.selectedMmsAttendanceId = this.selectedMmsAttendanceId || target.attendanceId || '';
        const selectedCandidate = candidates.find((candidate) => candidate.attendanceId === this.selectedMmsAttendanceId) || target;
        const candidateOptions = candidates
            .slice(0, 6)
            .map((candidate) => {
                const selected = candidate.attendanceId === this.selectedMmsAttendanceId ? 'selected' : '';
                const label = `${this.formatMmsLessonDate(candidate.eventStartDate)} · ${candidate.attendanceStatus || 'Unknown'}`;
                return `<option value="${this.escapeHtml(candidate.attendanceId)}" ${selected}>${this.escapeHtml(label)}</option>`;
            })
            .join('');
        const recipient = preview.recipients?.[0] || {};
        const recipientEmail = recipient.email || 'None';
        const recipientName = recipient.name || 'Parent';
        // Households with more than one parent on the MMS record (separated
        // parents, two carers). They are Bcc'd on the same send, so the tutor
        // must be able to see them before confirming — a silent copy is not a
        // confirmed one.
        const copiedTo = (preview.recipients || []).slice(1).filter((entry) => entry?.email);
        const selectionLabel = selectedCandidate.attendanceId !== target.attendanceId
            ? 'You selected this lesson from the date list.'
            : preview.targetSelection?.label || 'Selected from recent lessons found for this student.';

        this.mmsPreviewEl.innerHTML = `
            <label class="date-confirmation">
                <input id="mmsDateConfirm" type="checkbox" ${this.mmsDateConfirmed ? 'checked' : ''}>
                <span>
                    <strong>Lesson date:</strong>
                    ${this.escapeHtml(this.formatMmsLessonDate(selectedCandidate.eventStartDate))}
                </span>
            </label>
            <div><strong>Why this date:</strong> ${this.escapeHtml(selectionLabel)}</div>
            <div><strong>Current MMS status:</strong> ${this.escapeHtml(selectedCandidate.attendanceStatus || 'Unknown')}</div>
            ${isAbsentNoMakeup
                ? '<div class="absence-note"><strong>Absent:</strong> This will mark the student AbsentNoMakeup in MMS and will not email practice notes.</div>'
                : `<div><strong>Email will go to:</strong> ${this.escapeHtml(recipientName)} · ${this.escapeHtml(recipientEmail)}</div>
                   ${copiedTo.length ? `<div><strong>Also copied (Bcc):</strong> ${copiedTo.map((entry) => this.escapeHtml(entry.name || entry.email)).join(', ')}</div>` : ''}`}
            <label class="date-select-label" for="mmsAttendanceSelect">Wrong date?</label>
            <select id="mmsAttendanceSelect" class="date-select">
                ${candidateOptions}
            </select>
        `;
        this.mmsPreviewEl.style.display = 'block';
        this.updateMmsExecuteState();
    }

    handleMmsPreviewChange(event) {
        if (event.target.id === 'mmsDateConfirm') {
            this.mmsDateConfirmed = event.target.checked;
            this.updateMmsExecuteState();
            return;
        }
        if (event.target.id === 'mmsAttendanceSelect') {
            this.selectedMmsAttendanceId = event.target.value;
            this.mmsDateConfirmed = false;
            this.renderMmsPreview(this.lastMmsPreview);
        }
    }

    handleAttendanceStatusChange(event) {
        this.selectedMmsAttendanceStatus = event.target.value === 'AbsentNoMakeup' ? 'AbsentNoMakeup' : 'Present';
        this.updateMmsExecuteButtonLabel();
        if (this.lastMmsPreview && !this.mmsWorkflowComplete) {
            this.renderMmsPreview(this.lastMmsPreview);
        }
    }

    updateMmsExecuteState() {
        if (!this.mmsExecuteBtn) return;
        this.updateMmsExecuteButtonLabel();
        this.mmsExecuteBtn.disabled = !this.mmsDateConfirmed || !this.selectedMmsAttendanceId || this.mmsWorkflowComplete || this.mmsTestInFlight;
    }

    updateMmsExecuteButtonLabel() {
        if (!this.mmsExecuteBtn || this.mmsTestInFlight || this.mmsWorkflowComplete) return;
        this.mmsExecuteBtn.textContent = this.selectedMmsAttendanceStatus === 'AbsentNoMakeup'
            ? 'Mark absent in MMS'
            : this.mmsExecuteButtonLabel || 'Save notes, mark present & email parent';
    }

    setMmsExecuteButtonBusy(isBusy) {
        if (!this.mmsExecuteBtn) return;
        if (isBusy) {
            this.mmsExecuteBtn.classList.remove('is-complete', 'is-warning');
            this.mmsExecuteBtn.classList.add('is-loading');
            this.mmsExecuteBtn.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>Confirming...';
            return;
        }
        this.mmsExecuteBtn.classList.remove('is-loading', 'is-complete', 'is-warning');
        this.updateMmsExecuteButtonLabel();
    }

    setMmsExecuteButtonComplete(label = 'Lesson done ✓') {
        if (!this.mmsExecuteBtn) return;
        this.mmsExecuteBtn.classList.remove('is-loading', 'is-warning');
        this.mmsExecuteBtn.classList.add('is-complete');
        this.mmsExecuteBtn.disabled = true;
        this.mmsExecuteBtn.innerHTML = `<span class="button-check" aria-hidden="true">✓</span>${this.escapeHtml(label)}`;
    }

    setMmsExecuteButtonWarning(label = 'Needs follow-up') {
        if (!this.mmsExecuteBtn) return;
        this.mmsExecuteBtn.classList.remove('is-loading', 'is-complete');
        this.mmsExecuteBtn.classList.add('is-warning');
        this.mmsExecuteBtn.disabled = true;
        this.mmsExecuteBtn.textContent = label;
    }

    notifyDashboardPracticeChatComplete({ result = {}, status = 'completed' } = {}) {
        const message = {
            type: 'firstchord:practice-chat-complete',
            status,
            studentId: this.context.studentId,
            studentName: this.context.studentName,
            tutor: this.context.tutor,
            noteId: result.practiceNoteLog?.noteId || result.noteId || '',
            attendanceId: result.targetAttendance?.attendanceId || this.selectedMmsAttendanceId || ''
        };

        let targetOrigin = '*';
        try {
            if (this.context.dashboardBaseUrl) {
                targetOrigin = new URL(this.context.dashboardBaseUrl).origin;
            }
        } catch {
            targetOrigin = '*';
        }

        for (const target of [window.parent, window.opener]) {
            if (!target || target === window) continue;
            try {
                target.postMessage(message, targetOrigin);
            } catch (error) {
                console.warn('Practice Chat completion message failed:', error);
            }
        }
    }

    renderMmsSavingState(targetDate = '') {
        if (!this.mmsPreviewEl) return;
        const isAbsentNoMakeup = this.selectedMmsAttendanceStatus === 'AbsentNoMakeup';
        this.mmsPreviewEl.innerHTML = `
            <div class="saving-title">Finishing lesson admin...</div>
            <ul class="saving-list">
                ${isAbsentNoMakeup
                    ? `<li>Marking the student AbsentNoMakeup in MMS for ${this.escapeHtml(targetDate || 'the selected lesson')}</li><li>Skipping the parent practice-note email</li>`
                    : `<li>Saving notes to the dashboard</li><li>Marking attendance Present in MMS for ${this.escapeHtml(targetDate || 'the selected lesson')}</li><li>Emailing the practice notes to the parent</li>`}
            </ul>
        `;
        this.mmsPreviewEl.style.display = 'block';
    }

    renderMmsCompletion(result) {
        if (!this.mmsPreviewEl) return;
        const isAbsentNoMakeup = this.selectedMmsAttendanceStatus === 'AbsentNoMakeup'
            || result.requestedAttendanceStatus === 'AbsentNoMakeup';
        const target = result.targetAttendance || {};
        const email = result.practiceNoteEmail || result.emailNotes || {};
        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title">Done</div>
            <ul class="completion-list">
                ${isAbsentNoMakeup
                    ? `<li>Attendance marked AbsentNoMakeup in MMS for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li><li>No parent practice-note email was sent</li>`
                    : `<li>Saved to dashboard</li><li>Saved to MMS</li><li>Attendance marked Present for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li><li>Email sent to ${this.escapeHtml(email.toEmail || 'parent')}</li>`}
            </ul>
        `;
        this.mmsPreviewEl.style.display = 'block';
        this.mmsExecuteBtn.disabled = true;
    }

    renderMmsAlreadyCompleted(result) {
        if (!this.mmsPreviewEl) return;
        const isAbsentNoMakeup = this.selectedMmsAttendanceStatus === 'AbsentNoMakeup'
            || result.requestedAttendanceStatus === 'AbsentNoMakeup';
        const target = result.targetAttendance || {};
        const email = result.practiceNoteEmail || result.emailNotes || {};
        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title">Already done</div>
            <ul class="completion-list">
                ${isAbsentNoMakeup
                    ? `<li>This lesson was already marked AbsentNoMakeup for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li><li>No parent practice-note email was sent</li>`
                    : `<li>These exact notes were already saved for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li><li>The parent email has already been sent${email.sentAt ? ` at ${this.escapeHtml(this.formatDisplayDate(email.sentAt))}` : ''}</li><li>No duplicate email was sent</li>`}
            </ul>
        `;
        this.mmsPreviewEl.style.display = 'block';
        this.mmsExecuteBtn.disabled = true;
    }

    renderMmsInProgress() {
        if (!this.mmsPreviewEl) return;
        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title">Already working</div>
            <ul class="completion-list">
                <li>This note delivery is already being processed</li>
                <li>Wait a moment before trying again</li>
            </ul>
        `;
        this.mmsPreviewEl.style.display = 'block';
        this.mmsExecuteBtn.disabled = true;
    }

    renderMmsPartialCompletion(result) {
        if (!this.mmsPreviewEl) return;
        const target = result.targetAttendance || {};
        const email = result.practiceNoteEmail || result.emailNotes || {};
        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title warning-title">Saved, but email needs manual follow-up</div>
            <ul class="completion-list">
                <li>Saved to dashboard</li>
                <li>Saved to MMS</li>
                <li>Attendance marked Present for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li>
                <li>Email was not sent to ${this.escapeHtml(email.toEmail || 'parent')}</li>
            </ul>
            <div class="manual-follow-up">
                Send the notes manually from Gmail or MMS before closing the lesson admin.
                Error: ${this.escapeHtml(email.error || 'Unknown email error')}
            </div>
        `;
        this.mmsPreviewEl.style.display = 'block';
        this.mmsExecuteBtn.disabled = true;
    }

    renderMmsLogWarning(result) {
        if (!this.mmsPreviewEl) return;
        const target = result.targetAttendance || {};
        const email = result.practiceNoteEmail || result.emailNotes || {};
        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title warning-title">Done, but dashboard log needs checking</div>
            <ul class="completion-list">
                <li>Saved to MMS</li>
                <li>Attendance marked Present for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li>
                <li>Email sent to ${this.escapeHtml(email.toEmail || 'parent')}</li>
                <li>Dashboard note log failed</li>
            </ul>
            <div class="manual-follow-up">
                The parent email was sent, but the dashboard may not have saved the full note audit row.
                Error: ${this.escapeHtml(result.practiceNoteLog?.error || 'Unknown dashboard log error')}
            </div>
        `;
        this.mmsPreviewEl.style.display = 'block';
        this.mmsExecuteBtn.disabled = true;
    }

    confirmLessonFinish({ studentName = '', targetDate = '', attendanceStatus = 'Present', recipientName = '', recipientEmail = '', copiedTo = [], groupSummary = '' } = {}) {
        const student = studentName || this.context.studentName || 'this student';
        const date = targetDate || 'the selected lesson';
        const isAbsentNoMakeup = attendanceStatus === 'AbsentNoMakeup';

        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'action-confirm-backdrop';
            backdrop.innerHTML = `
                <div class="action-confirm-card" role="dialog" aria-modal="true" aria-labelledby="finishConfirmTitle">
                    <div class="action-confirm-kicker">Ready to finish?</div>
                    <h2 id="finishConfirmTitle">${isAbsentNoMakeup ? `Mark ${this.escapeHtml(student)} absent` : `Send ${this.escapeHtml(student)}’s practice notes`}</h2>
                    <p class="action-confirm-copy">
                        This will complete the lesson admin for ${this.escapeHtml(date)}.
                    </p>
                    <ul class="action-confirm-list">
                        ${isAbsentNoMakeup
                            ? '<li>Mark attendance AbsentNoMakeup in MMS</li><li>Do not email practice notes</li><li>Keep this as an attendance-only record</li>'
                            : `<li>Save the note to the dashboard</li><li>Mark attendance Present in MMS</li><li>Email these notes to ${this.escapeHtml(recipientName || 'the selected parent')} (${this.escapeHtml(recipientEmail || 'no email found')})</li>${copiedTo.length ? `<li>Copy in ${this.escapeHtml(copiedTo.map((entry) => entry.name || entry.email).join(', '))} (Bcc — they will not see each other’s address)</li>` : ''}`}
                    </ul>
                    ${groupSummary ? `<p class="action-confirm-copy lesson-group-summary">${this.escapeHtml(groupSummary)}</p>` : ''}
                    ${isAbsentNoMakeup ? '' : `<label class="date-confirmation action-confirm-check"><input id="sendRecipientConfirm" type="checkbox"><span>I confirm these are ${this.escapeHtml(student)}’s notes and they should be emailed to this parent.</span></label>`}
                    <div class="action-confirm-actions">
                        <button type="button" class="btn action-confirm-secondary" data-confirm="cancel">Go back</button>
                        <button type="button" class="btn btn-success action-confirm-primary" data-confirm="yes" ${isAbsentNoMakeup ? '' : 'disabled'}>${isAbsentNoMakeup ? 'Mark absent' : 'Finish lesson'}</button>
                    </div>
                </div>
            `;

            const cleanup = (answer) => {
                document.removeEventListener('keydown', onKeyDown);
                backdrop.remove();
                resolve(answer);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') cleanup(false);
            };

            backdrop.addEventListener('click', (event) => {
                const action = event.target?.dataset?.confirm;
                if (action === 'yes' && !event.target.disabled) cleanup(true);
                if (action === 'cancel' || event.target === backdrop) cleanup(false);
            });
            backdrop.querySelector('#sendRecipientConfirm')?.addEventListener('change', (event) => {
                const confirmButton = backdrop.querySelector('[data-confirm="yes"]');
                if (confirmButton) confirmButton.disabled = !event.target.checked;
            });
            document.addEventListener('keydown', onKeyDown);
            document.body.appendChild(backdrop);
            backdrop.querySelector('[data-confirm="yes"]')?.focus();
        });
    }

    async previewMmsTestWrite() {
        if (this.mmsTestInFlight) return;
        const noteText = this.getCurrentNoteText();
        if (!noteText) return;

        this.mmsTestInFlight = true;
        this.mmsExecuteBtn.disabled = true;
        if (this.mmsPreviewEl) {
            this.mmsPreviewEl.innerHTML = '<div class="preview-loading">Finding the suggested lesson date...</div>';
            this.mmsPreviewEl.style.display = 'block';
        }
        try {
            const preview = await previewPracticeNoteMmsTestWrite({
                dashboardBaseUrl: this.context.dashboardBaseUrl,
                studentId: this.context.studentId,
                noteText,
                attendanceStatus: this.selectedMmsAttendanceStatus,
                songIds: this.getSelectedSongIds(),
                unlistedSongTitles: this.unlistedSongTitles,
                practiceChatSecret: this.context.practiceChatSecret
            });
            this.lastMmsPreview = preview;
            this.selectedMmsAttendanceId = preview.targetAttendance?.attendanceId || '';
            this.mmsDateConfirmed = false;
            this.renderMmsPreview(preview);
            this.showStatus('Suggested lesson found. Tick the date if it is correct.', 'success');
            // Asked after the preview renders, so a slow or failing group lookup
            // never delays or breaks the ordinary one-student flow.
            await this.loadLessonGroup(noteText);
        } catch (error) {
            console.error('MMS test preview failed:', error);
            this.showStatus(error.message || 'MMS test preview failed', 'error');
        } finally {
            this.mmsTestInFlight = false;
            this.updateMmsExecuteState();
        }
    }

    async loadLessonGroup(noteText = '') {
        this.lessonGroup = null;
        if (!this.selectedMmsAttendanceId) return;
        try {
            const group = await previewPracticeNoteGroup({
                dashboardBaseUrl: this.context.dashboardBaseUrl,
                studentId: this.context.studentId,
                noteText,
                targetAttendanceId: this.selectedMmsAttendanceId,
                attendanceStatus: this.selectedMmsAttendanceStatus,
                tutor: this.context.tutor,
                practiceChatSecret: this.context.practiceChatSecret
            });
            if (!group?.isGroup) return;
            this.lessonGroup = group;
            this.groupDeliveryChosen = true;
            this.renderLessonGroup(group);
        } catch (error) {
            // A group lookup failure is not a reason to block the lesson. The
            // tutor finishes the student they opened, exactly as before.
            console.warn('Lesson group lookup failed:', error);
        }
    }

    renderLessonGroup(group) {
        if (!this.mmsPreviewEl || !group?.isGroup) return;
        const others = (group.group?.plan || []).filter((entry) => !entry.isLead);
        if (!others.length) return;

        const names = others.map((entry) => this.escapeHtml(entry.studentName)).join(', ');
        const block = document.createElement('div');
        block.className = 'lesson-group';
        block.innerHTML = `
            <label class="date-confirmation">
                <input id="groupDeliveryToggle" type="checkbox" checked>
                <span>Also finish ${names}</span>
            </label>
            <div class="lesson-group-summary">${this.escapeHtml(group.summary || '')}</div>
        `;
        this.mmsPreviewEl.appendChild(block);

        const toggle = block.querySelector('#groupDeliveryToggle');
        toggle?.addEventListener('change', (event) => {
            this.groupDeliveryChosen = Boolean(event.target.checked);
            this.updateMmsExecuteButtonLabel();
        });
        this.updateMmsExecuteButtonLabel();
    }

    isGroupDelivery() {
        return Boolean(this.lessonGroup?.isGroup && this.groupDeliveryChosen);
    }

    async executeGroupWrite(noteText) {
        this.mmsTestInFlight = true;
        this.setMmsExecuteButtonBusy(true);
        this.renderMmsSavingState(this.formatMmsLessonDate(this.lastMmsPreview?.targetAttendance?.eventStartDate));
        try {
            const result = await executePracticeNoteGroup({
                dashboardBaseUrl: this.context.dashboardBaseUrl,
                studentId: this.context.studentId,
                noteText,
                targetAttendanceId: this.selectedMmsAttendanceId,
                attendanceStatus: this.selectedMmsAttendanceStatus,
                noteSnapshot: buildPracticeNoteSnapshot({
                    context: this.context,
                    rawNoteText: noteText,
                    songIds: this.getSelectedSongIds(),
                    unlistedSongTitles: this.unlistedSongTitles
                }),
                tutor: this.context.tutor,
                practiceChatSecret: this.context.practiceChatSecret
            });

            this.renderGroupCompletion(result);
            this.mmsWorkflowComplete = result.status === 'completed';
            if (result.status === 'completed') {
                this.setMmsExecuteButtonComplete('Lesson done ✓');
                this.notifyDashboardPracticeChatComplete({ result, status: 'completed' });
            } else {
                // Partial is its own state: one sister marked and the other not
                // must never read as done.
                this.setMmsExecuteButtonWarning('Needs follow-up');
                this.showStatus(result.message || 'Some students still need sorting.', 'warning');
            }
            return true;
        } catch (error) {
            console.error('Group lesson delivery failed:', error);
            this.showStatus(error.message || 'Group lesson delivery failed', 'error');
            this.setMmsExecuteButtonBusy(false);
            return false;
        } finally {
            this.mmsTestInFlight = false;
        }
    }

    renderGroupCompletion(result) {
        if (!this.mmsPreviewEl) return;
        const rows = (result.results || []).map((entry) => {
            const mark = entry.attendanceSaved ? '✓' : '✗';
            const email = entry.emailSent
                ? ' · email sent'
                : entry.emailReason === 'covered_by_group_email'
                    ? ' · included in the group email'
                    : entry.emailReason === 'attendance_only_lesson'
                        ? ''
                        : entry.error
                            ? ` · ${this.escapeHtml(entry.error)}`
                            : '';
            return `<li>${mark} ${this.escapeHtml(entry.studentName)}${email}</li>`;
        }).join('');

        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title">${result.status === 'completed' ? 'Done' : 'Partly done'}</div>
            <ul class="completion-list">${rows}</ul>
            <div class="lesson-group-summary">${this.escapeHtml(result.message || '')}</div>
        `;
        this.mmsPreviewEl.style.display = 'block';
    }

    async executeMmsTestWrite() {
        if (this.mmsTestInFlight) return;
        const noteText = this.getCurrentNoteText();
        const targetAttendanceId = this.selectedMmsAttendanceId || '';
        let finalButtonHandled = false;
        if (!noteText || !targetAttendanceId) {
            this.showStatus('Confirm the lesson date first', 'warning');
            return;
        }
        if (!this.mmsDateConfirmed) {
            this.showStatus('Tick the lesson date before saving', 'warning');
            return;
        }

        // Runs on the note as it stands now, including any tutor edits, and
        // before the send confirmation so wording gets fixed first.
        const safety = checkNoteSafety(noteText);
        recordSafety(this.session, { flags: safety.ok ? 0 : safety.findings.length });
        if (!safety.ok) {
            const acknowledged = await this.confirmNoteSafety(safety.findings);
            if (!acknowledged) {
                this.showStatus('Edit the note, then finish the lesson.', 'info');
                return;
            }
            // Whether the flag was a real mis-hearing or a false positive is the
            // question; that the tutor confirmed it is the evidence.
            recordSafety(this.session, { acknowledged: true });
        }

        const candidates = this.lastMmsPreview?.candidateAttendances || [];
        const selectedCandidate = candidates.find((candidate) => candidate.attendanceId === targetAttendanceId) || this.lastMmsPreview?.targetAttendance || {};
        const targetDate = this.formatMmsLessonDate(selectedCandidate.eventStartDate);
        const groupDelivery = this.isGroupDelivery();
        const confirmed = await this.confirmLessonFinish({
            studentName: groupDelivery
                ? (this.lessonGroup.group?.plan || []).map((entry) => entry.studentName).join(' and ')
                : this.context.studentName,
            targetDate,
            attendanceStatus: this.selectedMmsAttendanceStatus,
            recipientName: this.lastMmsPreview?.recipients?.[0]?.name || '',
            recipientEmail: this.lastMmsPreview?.recipients?.[0]?.email || '',
            copiedTo: (this.lastMmsPreview?.recipients || []).slice(1).filter((entry) => entry?.email),
            groupSummary: groupDelivery ? this.lessonGroup.summary : '',
        });
        if (!confirmed) {
            return;
        }

        // One note, every student on the lesson, one email per household. The
        // server owns the household grouping; this only decides whether the
        // tutor asked for the whole lesson or just the student they opened.
        if (groupDelivery) {
            await this.executeGroupWrite(noteText);
            return;
        }

        this.mmsTestInFlight = true;
        this.mmsExecuteBtn.disabled = true;
        this.setMmsExecuteButtonBusy(true);
        this.renderMmsSavingState(targetDate);
        this.showStatus('Finishing lesson admin...', 'info');
        try {
            const noteSnapshot = buildPracticeNoteSnapshot({
                context: this.context,
                noteText,
                songIds: this.getSelectedSongIds(),
                unlistedSongTitles: this.unlistedSongTitles
            });
            const result = await executePracticeNoteMmsTestWrite({
                dashboardBaseUrl: this.context.dashboardBaseUrl,
                studentId: this.context.studentId,
                noteText,
                targetAttendanceId,
                attendanceStatus: this.selectedMmsAttendanceStatus,
                songIds: this.getSelectedSongIds(),
                unlistedSongTitles: this.unlistedSongTitles,
                noteSnapshot,
                confirmedRecipientEmail: this.lastMmsPreview?.recipients?.[0]?.email || '',
                practiceChatSecret: this.context.practiceChatSecret
            });
            this.lastMmsPreview = result;
            this.renderMmsPreview(result);
            if (result.inProgress || result.idempotency?.status === 'in_progress') {
                this.mmsWorkflowComplete = false;
                this.renderMmsInProgress();
                this.showStatus('Already processing this note delivery. Wait a moment and check again.', 'info');
            } else if (result.duplicateSkipped || result.idempotency?.status === 'already_completed') {
                this.mmsWorkflowComplete = true;
                this.renderMmsAlreadyCompleted(result);
                this.setMmsExecuteButtonComplete('Already done ✓');
                finalButtonHandled = true;
                this.finishSession('already_done', { noteId: result.practiceNoteLog?.noteId || '' });
                this.notifyDashboardPracticeChatComplete({ result, status: 'already_completed' });
                this.showStatus('Already done: no duplicate parent email was sent', 'success');
            } else if (result.emailNotes?.ok === false) {
                this.mmsWorkflowComplete = true;
                this.renderMmsPartialCompletion(result);
                this.setMmsExecuteButtonWarning('Manual follow-up needed');
                finalButtonHandled = true;
                this.finishSession('manual_follow_up', { noteId: result.practiceNoteLog?.noteId || '' });
                this.showStatus('Saved to dashboard and MMS. Email needs manual follow-up.', 'warning');
            } else if (result.practiceNoteLog?.ok === false) {
                this.mmsWorkflowComplete = true;
                this.renderMmsLogWarning(result);
                this.setMmsExecuteButtonWarning('Dashboard log needs checking');
                finalButtonHandled = true;
                this.finishSession('manual_follow_up');
                this.showStatus('Email sent and MMS updated, but the dashboard log needs checking.', 'warning');
            } else {
                this.mmsWorkflowComplete = true;
                this.renderMmsCompletion(result);
                this.setMmsExecuteButtonComplete(this.selectedMmsAttendanceStatus === 'AbsentNoMakeup'
                    ? 'Absent marked ✓'
                    : 'Lesson done ✓');
                finalButtonHandled = true;
                this.finishSession(
                    this.selectedMmsAttendanceStatus === 'AbsentNoMakeup' ? 'absent_no_makeup' : 'sent',
                    { noteId: result.practiceNoteLog?.noteId || '' }
                );
                this.notifyDashboardPracticeChatComplete({
                    result,
                    status: this.selectedMmsAttendanceStatus === 'AbsentNoMakeup' ? 'absent_no_makeup' : 'completed'
                });
                this.showStatus(this.selectedMmsAttendanceStatus === 'AbsentNoMakeup'
                    ? 'Done: attendance marked absent in MMS'
                    : 'Done: notes saved, attendance marked present, and parent email sent',
                'success');
            }
        } catch (error) {
            console.error('MMS test write failed:', error);
            // A hard failure the tutor has to resolve, not an abandonment. The
            // session stays unfinished so the outcome does not claim a delivery
            // that never happened, but the reason is recorded.
            if (this.session) {
                this.session.outcome = 'failed';
                this.sendSessionTelemetry();
            }
            this.showStatus(error.message || 'MMS test write failed', 'error');
        } finally {
            this.mmsTestInFlight = false;
            if (!finalButtonHandled) {
                this.setMmsExecuteButtonBusy(false);
            }
            this.updateMmsExecuteState();
        }
    }

    clearNotes() {
        if (!confirm('Clear all notes? This cannot be undone.')) return;

        this.currentQuestionIndex = 0;
        this.questionAnswers = ['', '', ''];
        this.currentTranscript = '';
        this.selectedSongIds.clear();
        this.unlistedSongTitles = [];
        this.suggestedSongs = [];
        this.songSelectionLocked = false;
        this.renderSongChoices();
        this.processedEl.textContent = NOTE_PLACEHOLDER;
        this.outputSection.classList.remove('show');
        this.questionSection.style.display = 'block';

        localStorage.removeItem('lastNotes');
        localStorage.removeItem('lastNotesTimestamp');

        this.updateQuestionDisplay();
        this.showStatus('Notes cleared', 'info');
    }

    resetForNew() {
        this.currentQuestionIndex = 0;
        this.questionAnswers = ['', '', ''];
        this.currentTranscript = '';
        this.selectedSongIds.clear();
        this.unlistedSongTitles = [];
        this.suggestedSongs = [];
        this.songSelectionLocked = false;
        this.renderSongChoices();
        this.processedEl.textContent = NOTE_PLACEHOLDER;
        this.outputSection.classList.remove('show');
        this.questionSection.style.display = 'block';

        // Reset copy button
        this.resetMmsTestState();

        // Hide attendance reminder
        const reminderEl = document.getElementById('attendanceReminder');
        if (reminderEl) {
            reminderEl.style.display = 'none';
        }

        this.updateQuestionDisplay();
        this.showStatus('Ready for new recording', 'info');
    }

    saveNotes(text) {
        try {
            localStorage.setItem('lastNotes', text);
            localStorage.setItem('lastNotesTimestamp', Date.now().toString());
            console.log('✅ Notes saved to localStorage');
        } catch (error) {
            console.error('Failed to save notes:', error);
        }
    }

    loadPreviousNotes() {
        try {
            const lastNotes = localStorage.getItem('lastNotes');
            const timestamp = localStorage.getItem('lastNotesTimestamp');

            if (lastNotes && timestamp) {
                const ageHours = (Date.now() - parseInt(timestamp)) / (1000 * 60 * 60);

                // Only load if less than 24 hours old
                if (ageHours < 24) {
                    // A saved draft is markup, so restore it as formatting
                    // rather than as visible asterisks.
                    this.setNoteContent(lastNotes);
                    this.outputSection.classList.add('show');
                    this.showStatus(`Previous notes loaded (${Math.round(ageHours)}h ago)`, 'info');
                }
            }
        } catch (error) {
            console.error('Failed to load previous notes:', error);
        }
    }

    showStatus(message, type = 'info') {
        this.statusEl.textContent = message;
        this.statusEl.className = `status ${type}`;
        this.statusEl.style.display = 'block';

        // Auto-hide success/info messages after 5 seconds
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                if (this.statusEl.textContent === message) {
                    this.statusEl.style.display = 'none';
                }
            }, 5000);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log(`🎵 Practice Chat initializing... build ${PRACTICE_CHAT_BUILD}`);
    new PracticeChatApp();
});
