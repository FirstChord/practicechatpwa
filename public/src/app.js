// Practice Chat - Main Application
// Handles recording, transcription, and UI

import { WhisperASRClient } from './asr-client.js';
import { enhancedCleanupSpeechText } from './text-processor.js';

class PracticeChatApp {
    constructor() {
        this.asrClient = null;
        this.isRecording = false;
        this.rawTranscript = '';

        this.initializeElements();
        this.bindEvents();
        this.loadPreviousNotes();
    }

    initializeElements() {
        this.recordBtn = document.getElementById('recordBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.copyBtn = document.getElementById('copyBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.newBtn = document.getElementById('newBtn');

        this.statusEl = document.getElementById('status');
        this.transcriptEl = document.getElementById('transcript');
        this.processedEl = document.getElementById('processed');
        this.outputSection = document.getElementById('outputSection');
    }

    bindEvents() {
        this.recordBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.clearBtn.addEventListener('click', () => this.clearNotes());
        this.newBtn.addEventListener('click', () => this.resetForNew());
    }

    async startRecording() {
        try {
            this.showStatus('Starting recording...', 'info');

            // Create new Whisper ASR client
            this.asrClient = new WhisperASRClient();

            // Set up callbacks
            this.asrClient.onPartialTranscript = (text) => {
                // Show fun processing messages
                this.transcriptEl.textContent = text;
            };

            this.asrClient.onFinalTranscript = (text) => {
                this.rawTranscript = text;
                this.transcriptEl.textContent = text;
                this.processTranscript();
            };

            this.asrClient.onError = (error) => {
                this.showStatus(`Error: ${error.message}`, 'error');
                this.isRecording = false;
                this.recordBtn.disabled = false;
                this.stopBtn.disabled = true;
            };

            // Start recording
            await this.asrClient.start();

            this.isRecording = true;
            this.recordBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.showStatus('🎤 Recording... Speak naturally about the lesson', 'recording');
            this.transcriptEl.textContent = 'Listening...';

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showStatus(`Failed to start: ${error.message}`, 'error');
            this.isRecording = false;
            this.recordBtn.disabled = false;
            this.stopBtn.disabled = true;
        }
    }

    async stopRecording() {
        if (!this.asrClient) return;

        try {
            this.showStatus('Processing... (this may take a few seconds)', 'info');
            this.stopBtn.disabled = true;

            // Stop recording and get transcript
            await this.asrClient.stop();

            this.isRecording = false;
            this.recordBtn.disabled = false;
            this.showStatus('Recording complete!', 'success');

        } catch (error) {
            console.error('Failed to process recording:', error);
            this.showStatus(`Processing failed: ${error.message}`, 'error');
            this.isRecording = false;
            this.recordBtn.disabled = false;
            this.stopBtn.disabled = true;
        } finally {
            this.asrClient = null;
        }
    }

    processTranscript() {
        if (!this.rawTranscript.trim()) {
            this.showStatus('No transcript to process', 'warning');
            return;
        }

        // Clean up the text
        const result = enhancedCleanupSpeechText(this.rawTranscript);

        // Display processed text
        this.processedEl.textContent = result.text;
        this.outputSection.classList.add('show');

        // Save to localStorage
        this.saveNotes(result.text);

        console.log('Enhancements:', result.enhancements);
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

            const originalText = this.copyBtn.textContent;
            this.copyBtn.textContent = '✅ Copied!';
            setTimeout(() => {
                this.copyBtn.textContent = originalText;
            }, 2000);
        } catch (error) {
            console.error('Copy failed:', error);
            this.showStatus('Failed to copy', 'error');
        }
    }

    clearNotes() {
        if (!confirm('Clear all notes? This cannot be undone.')) return;

        this.rawTranscript = '';
        this.transcriptEl.textContent = 'Transcript will appear here...';
        this.processedEl.textContent = 'Processed notes will appear here...';
        this.outputSection.classList.remove('show');

        localStorage.removeItem('lastNotes');
        localStorage.removeItem('lastNotesTimestamp');

        this.showStatus('Notes cleared', 'info');
    }

    resetForNew() {
        this.rawTranscript = '';
        this.transcriptEl.textContent = 'Transcript will appear here...';
        this.processedEl.textContent = 'Processed notes will appear here...';
        this.outputSection.classList.remove('show');
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
