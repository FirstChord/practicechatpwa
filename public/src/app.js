// Practice Chat - Main Application
// Handles recording, transcription, and UI with three-question flow

import { WhisperASRClient } from './asr-client.js';
import { enhancedCleanupSpeechText } from './text-processor.js';

const QUESTIONS = [
    "What did we do in the lesson?",
    "What went well or what was challenging?",
    "What would be good practice over the week? (and how!)"
];

const QUESTION_LABELS = [
    "What we did:",
    "Progress & Challenges:",
    "Practice Goals:"
];

class PracticeChatApp {
    constructor() {
        this.asrClient = null;
        this.isRecording = false;
        this.currentQuestionIndex = 0;
        this.questionAnswers = ['', '', '']; // Store answers for each question
        this.currentTranscript = '';

        this.initializeElements();
        this.bindEvents();
        this.updateQuestionDisplay();
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
            // Automatically start recording for the next question
            this.startRecording();
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
            // Automatically start recording for the previous question
            this.startRecording();
        }
    }

    nextQuestion() {
        if (this.currentQuestionIndex < 2) {
            this.currentQuestionIndex++;
            this.updateQuestionDisplay();
            // Automatically start recording for the next question
            this.startRecording();
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
            this.showStatus('✅ Copied to clipboard!', 'success');

            // Change button to "Take Attendance"
            this.copyBtn.innerHTML = '<span class="btn-icon">✅</span>Take Attendance';
            this.copyBtn.onclick = () => {
                window.location.href = 'https://mymusicstaff.com';
            };

            // Show attendance reminder
            const reminderEl = document.getElementById('attendanceReminder');
            if (reminderEl) {
                reminderEl.style.display = 'block';
            }
        } catch (error) {
            console.error('Copy failed:', error);
            this.showStatus('Failed to copy', 'error');
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
        this.copyBtn.innerHTML = '<span class="btn-icon">📋</span>Copy Notes';
        this.copyBtn.onclick = () => this.copyToClipboard();

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
