// Practice Chat - Main Application
// Handles recording, transcription, and UI with three-question flow

import { WhisperASRClient } from './asr-client.js';
import { enhancedCleanupSpeechText } from './text-processor.js';
import {
    buildPracticeNoteSnapshot,
    executePracticeNoteMmsTestWrite,
    getPracticeChatContext,
    isLocalMmsWriteTestAvailable,
    previewPracticeNoteMmsTestWrite,
    savePracticeNoteSnapshot
} from './practice-note-sync.js';

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

class PracticeChatApp {
    constructor() {
        this.asrClient = null;
        this.isRecording = false;
        this.currentQuestionIndex = 0;
        this.questionAnswers = ['', '', '']; // Store answers for each question
        this.currentTranscript = '';
        this.context = getPracticeChatContext(window.location.search);
        this.lastDashboardSavedText = '';
        this.dashboardSaveInFlight = false;
        this.mmsTestInFlight = false;
        this.lastMmsPreview = null;
        this.selectedMmsAttendanceId = '';
        this.mmsDateConfirmed = false;
        this.mmsWorkflowComplete = false;
        this.mmsExecuteButtonLabel = '';

        this.initializeElements();
        this.bindEvents();
        this.updateQuestionDisplay();
        this.configureMmsTestPanel();
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

        // Answer display
        this.currentAnswerEl = document.getElementById('currentAnswer');

        // Output elements
        this.copyBtn = document.getElementById('copyBtn');
        this.newBtn = document.getElementById('newBtn');
        this.statusEl = document.getElementById('status');
        this.processedEl = document.getElementById('processed');
        this.outputSection = document.getElementById('outputSection');
        this.mmsTestPanel = document.getElementById('mmsTestPanel');
        this.mmsExecuteBtn = document.getElementById('mmsExecuteBtn');
        this.mmsPreviewEl = document.getElementById('mmsPreview');

        // Question section
        this.questionSection = document.getElementById('questionSection');

        // Button state
        this.buttonState = 'start'; // start, stop, next, finish
    }

    bindEvents() {
        this.mainActionBtn.addEventListener('click', () => this.handleMainAction());
        this.skipBtn.addEventListener('click', () => this.skipQuestion());
        this.backBtn.addEventListener('click', () => this.previousQuestion());
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.newBtn.addEventListener('click', () => this.resetForNew());
        this.processedEl.addEventListener('input', () => this.invalidateMmsPreview());
        if (this.mmsExecuteBtn) {
            this.mmsExecuteButtonLabel = this.mmsExecuteBtn.textContent;
            this.mmsExecuteBtn.addEventListener('click', () => this.executeMmsTestWrite());
        }
        if (this.mmsPreviewEl) {
            this.mmsPreviewEl.addEventListener('change', (event) => this.handleMmsPreviewChange(event));
        }
    }

    configureMmsTestPanel() {
        if (!this.mmsTestPanel) return;
        if (isLocalMmsWriteTestAvailable({ context: this.context })) {
            this.mmsTestPanel.style.display = 'block';
            this.copyBtn.style.display = 'none';
        }
    }

    resetMmsTestState() {
        this.lastMmsPreview = null;
        this.selectedMmsAttendanceId = '';
        this.mmsDateConfirmed = false;
        this.mmsWorkflowComplete = false;
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

    invalidateMmsPreview() {
        if (!this.lastMmsPreview || this.mmsWorkflowComplete) return;
        this.showStatus('Notes updated. The final save will use the edited version.', 'info');
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
            this.asrClient = new WhisperASRClient();

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
                this.showStatus(`Error: ${error.message}`, 'error');
                this.isRecording = false;
                this.updateMainButton('start', 'Start Recording', '🎤');
                this.skipBtn.disabled = false;
            };

            // Start recording
            await this.asrClient.start();

            this.isRecording = true;
            this.updateMainButton('stop', 'Stop Recording', '⏹️');
            this.skipBtn.disabled = true;
            this.backBtn.disabled = true;
            this.showStatus('🎤 Recording... Speak naturally', 'recording');

        } catch (error) {
            console.error('Failed to start recording:', error);
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

            // Stop recording and get transcript
            await this.asrClient.stop();

            this.isRecording = false;
            this.skipBtn.disabled = false;
            this.backBtn.disabled = false;
            this.mainActionBtn.disabled = false;
            this.showStatus('Answer recorded!', 'success');

        } catch (error) {
            console.error('Failed to process recording:', error);
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
        this.questionAnswers[this.currentQuestionIndex] = '';
        if (this.currentQuestionIndex < 2) {
            this.currentQuestionIndex++;
            this.updateQuestionDisplay();
        } else {
            this.finishRecording();
        }
    }

    previousQuestion() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            // Clear the previous answer to allow re-recording
            this.questionAnswers[this.currentQuestionIndex] = '';
            this.updateQuestionDisplay();
        }
    }

    nextQuestion() {
        if (this.currentQuestionIndex < 2) {
            this.currentQuestionIndex++;
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

        // Save to localStorage
        this.saveNotes(output.trim());
    }


    async copyToClipboard() {
        const text = this.processedEl.textContent;

        if (!text || text === 'Processed notes will appear here...') {
            this.showStatus('No content to copy', 'warning');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            const snapshot = await this.saveDashboardSnapshotForCurrentNote();
            this.showStatus(snapshot
                ? '✅ Copied and saved to dashboard'
                : '✅ Copied to clipboard!',
            'success');

            if (!isLocalMmsWriteTestAvailable({ context: this.context })) {
                // Legacy/fallback flow for normal use outside the local Test Studenty pilot.
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

        const text = this.processedEl.textContent;
        const snapshot = buildPracticeNoteSnapshot({
            context: this.context,
            noteText: text
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
        const text = this.processedEl.textContent.trim();
        if (!text || text === 'Processed notes will appear here...') {
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
        const recipientEmails = (preview.recipients || [])
            .map((recipient) => recipient.email)
            .filter(Boolean)
            .join(', ') || 'None';
        const recipientNames = (preview.recipients || [])
            .map((recipient) => recipient.name)
            .filter(Boolean)
            .join(', ') || 'Parent';
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
            <div><strong>Email will go to:</strong> ${this.escapeHtml(recipientNames)} · ${this.escapeHtml(recipientEmails)}</div>
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

    updateMmsExecuteState() {
        if (!this.mmsExecuteBtn) return;
        this.mmsExecuteBtn.disabled = !this.mmsDateConfirmed || !this.selectedMmsAttendanceId || this.mmsWorkflowComplete || this.mmsTestInFlight;
    }

    setMmsExecuteButtonBusy(isBusy) {
        if (!this.mmsExecuteBtn) return;
        if (isBusy) {
            this.mmsExecuteBtn.classList.add('is-loading');
            this.mmsExecuteBtn.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>Saving...';
            return;
        }
        this.mmsExecuteBtn.classList.remove('is-loading');
        this.mmsExecuteBtn.textContent = this.mmsExecuteButtonLabel || 'Save notes, mark present & email parent';
    }

    renderMmsSavingState(targetDate = '') {
        if (!this.mmsPreviewEl) return;
        this.mmsPreviewEl.innerHTML = `
            <div class="saving-title">Finishing lesson admin...</div>
            <ul class="saving-list">
                <li>Saving notes to the dashboard</li>
                <li>Marking attendance Present in MMS for ${this.escapeHtml(targetDate || 'the selected lesson')}</li>
                <li>Emailing the practice notes to the parent</li>
            </ul>
        `;
        this.mmsPreviewEl.style.display = 'block';
    }

    renderMmsCompletion(result) {
        if (!this.mmsPreviewEl) return;
        const target = result.targetAttendance || {};
        const email = result.practiceNoteEmail || result.emailNotes || {};
        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title">Done</div>
            <ul class="completion-list">
                <li>Saved to dashboard</li>
                <li>Saved to MMS</li>
                <li>Attendance marked Present for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li>
                <li>Email sent to ${this.escapeHtml(email.toEmail || 'parent')}</li>
            </ul>
        `;
        this.mmsPreviewEl.style.display = 'block';
        this.mmsExecuteBtn.disabled = true;
    }

    renderMmsAlreadyCompleted(result) {
        if (!this.mmsPreviewEl) return;
        const target = result.targetAttendance || {};
        const email = result.practiceNoteEmail || result.emailNotes || {};
        this.mmsPreviewEl.innerHTML = `
            <div class="completion-title">Already done</div>
            <ul class="completion-list">
                <li>These exact notes were already saved for ${this.escapeHtml(this.formatMmsLessonDate(target.eventStartDate))}</li>
                <li>The parent email has already been sent${email.sentAt ? ` at ${this.escapeHtml(this.formatDisplayDate(email.sentAt))}` : ''}</li>
                <li>No duplicate email was sent</li>
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

    confirmLessonFinish({ studentName = '', targetDate = '' } = {}) {
        const student = studentName || this.context.studentName || 'this student';
        const date = targetDate || 'the selected lesson';

        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'action-confirm-backdrop';
            backdrop.innerHTML = `
                <div class="action-confirm-card" role="dialog" aria-modal="true" aria-labelledby="finishConfirmTitle">
                    <div class="action-confirm-kicker">Ready to finish?</div>
                    <h2 id="finishConfirmTitle">Send ${this.escapeHtml(student)}’s practice notes</h2>
                    <p class="action-confirm-copy">
                        This will complete the lesson admin for ${this.escapeHtml(date)}.
                    </p>
                    <ul class="action-confirm-list">
                        <li>Save the note to the dashboard</li>
                        <li>Mark attendance Present in MMS</li>
                        <li>Email the parent from First Chord</li>
                    </ul>
                    <div class="action-confirm-actions">
                        <button type="button" class="btn action-confirm-secondary" data-confirm="cancel">Go back</button>
                        <button type="button" class="btn btn-success action-confirm-primary" data-confirm="yes">Finish lesson</button>
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
                practiceChatSecret: this.context.practiceChatSecret
            });
            this.lastMmsPreview = preview;
            this.selectedMmsAttendanceId = preview.targetAttendance?.attendanceId || '';
            this.mmsDateConfirmed = false;
            this.renderMmsPreview(preview);
            this.showStatus('Suggested lesson found. Tick the date if it is correct.', 'success');
        } catch (error) {
            console.error('MMS test preview failed:', error);
            this.showStatus(error.message || 'MMS test preview failed', 'error');
        } finally {
            this.mmsTestInFlight = false;
            this.updateMmsExecuteState();
        }
    }

    async executeMmsTestWrite() {
        if (this.mmsTestInFlight) return;
        const noteText = this.getCurrentNoteText();
        const targetAttendanceId = this.selectedMmsAttendanceId || '';
        if (!noteText || !targetAttendanceId) {
            this.showStatus('Confirm the lesson date first', 'warning');
            return;
        }
        if (!this.mmsDateConfirmed) {
            this.showStatus('Tick the lesson date before saving', 'warning');
            return;
        }

        const candidates = this.lastMmsPreview?.candidateAttendances || [];
        const selectedCandidate = candidates.find((candidate) => candidate.attendanceId === targetAttendanceId) || this.lastMmsPreview?.targetAttendance || {};
        const targetDate = this.formatMmsLessonDate(selectedCandidate.eventStartDate);
        const confirmed = await this.confirmLessonFinish({
            studentName: this.context.studentName,
            targetDate
        });
        if (!confirmed) {
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
                noteText
            });
            const result = await executePracticeNoteMmsTestWrite({
                dashboardBaseUrl: this.context.dashboardBaseUrl,
                studentId: this.context.studentId,
                noteText,
                targetAttendanceId,
                noteSnapshot,
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
                this.showStatus('Already done: no duplicate parent email was sent', 'success');
            } else if (result.emailNotes?.ok === false) {
                this.mmsWorkflowComplete = true;
                this.renderMmsPartialCompletion(result);
                this.showStatus('Saved to dashboard and MMS. Email needs manual follow-up.', 'warning');
            } else if (result.practiceNoteLog?.ok === false) {
                this.mmsWorkflowComplete = true;
                this.renderMmsLogWarning(result);
                this.showStatus('Email sent and MMS updated, but the dashboard log needs checking.', 'warning');
            } else {
                this.mmsWorkflowComplete = true;
                this.renderMmsCompletion(result);
                this.showStatus('Done: notes saved, attendance marked present, and parent email sent', 'success');
            }
        } catch (error) {
            console.error('MMS test write failed:', error);
            this.showStatus(error.message || 'MMS test write failed', 'error');
        } finally {
            this.mmsTestInFlight = false;
            this.setMmsExecuteButtonBusy(false);
            this.updateMmsExecuteState();
        }
    }

    clearNotes() {
        if (!confirm('Clear all notes? This cannot be undone.')) return;

        this.currentQuestionIndex = 0;
        this.questionAnswers = ['', '', ''];
        this.currentTranscript = '';
        this.processedEl.textContent = 'Processed notes will appear here...';
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
        this.processedEl.textContent = 'Processed notes will appear here...';
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
                    this.processedEl.textContent = lastNotes;
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
    console.log('🎵 Practice Chat initializing...');
    new PracticeChatApp();
});
