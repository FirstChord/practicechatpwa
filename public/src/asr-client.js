// Practice Chat - ASR Client Module
// Records the answer, then sends the audio to the dashboard, which calls OpenAI
// server-side and returns only the text. The browser never holds an API key:
// it used to fetch the raw key from the relay's /api-key and call OpenAI itself.

// The transcription model, in one place so the value is always the model that
// actually produced the text.
//
// Default stays whisper-1 until a trial says otherwise. The dashboard appends
// ?asrModel=… when NEXT_PUBLIC_PRACTICE_CHAT_ASR_MODEL is set on Railway, so a
// trial is a config change for the whole school rather than something a tutor
// has to remember mid-lesson.
export const DEFAULT_ASR_MODEL = 'whisper-1';

// No model allow-list here any more. Transcription runs through the
// dashboard, which owns the only list (lib/config/practice-chat-asr.mjs) and
// falls back to whisper-1 for anything it does not recognise, so a second copy
// here could only drift: a model added there but not here would silently cancel
// a trial. This only refuses values that are not shaped like a model name.
// The model actually used comes back with the text and is what gets recorded.
const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function resolveAsrModel(search = '') {
    const requested = `${new URLSearchParams(search || '').get('asrModel') || ''}`.trim();
    return MODEL_NAME.test(requested) ? requested : DEFAULT_ASR_MODEL;
}

// Shown in a shimmering line while the answer is transcribed. No emojis: the
// lines from the original set that stood up without one were kept, the rest
// replaced with quieter musical ones.
const PROCESSING_MESSAGES = [
    "Taking note of your notes…",
    "Dramatic pause…",
    "Consulting the crystal ball of transcription…",
    "Walking 500 miles…",
    "Processing how incredibly good your notes are…",
    "Tuning up the transcript…",
    "Finding the downbeat…",
    "Counting it in…",
    "Writing it all down…",
    "Turning the page…",
    "Tidying the bar lines…",
    "Listening back…",
    "Polishing the phrasing…"
];

function getRandomProcessingMessage() {
    return PROCESSING_MESSAGES[Math.floor(Math.random() * PROCESSING_MESSAGES.length)];
}

// Opened from a bookmark there is no dashboard to transcribe through. Said
// before recording starts, so nobody talks for two minutes into a dead end.
export const NO_DASHBOARD_MESSAGE = 'Voice notes need Practice Chat opened from the dashboard. Use “Type notes instead”.';

/**
 * POST recorded audio to the dashboard's transcription route; resolve to text.
 */
export async function transcribeViaDashboard({
    dashboardBaseUrl = '',
    practiceChatSecret = '',
    audioBlob,
    model = DEFAULT_ASR_MODEL,
    prompt = '',
    fetchImpl = fetch
} = {}) {
    if (!dashboardBaseUrl) throw new Error(NO_DASHBOARD_MESSAGE);

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', model);
    if (prompt) formData.append('prompt', prompt);

    const response = await fetchImpl(`${dashboardBaseUrl}/api/practice-notes/transcribe`, {
        method: 'POST',
        headers: {
            ...(practiceChatSecret ? { 'X-FirstChord-PracticeChat-Secret': practiceChatSecret } : {})
        },
        body: formData
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Transcription failed (${response.status})`);
    }
    // The dashboard reports the model it actually used, which differs from the
    // request whenever it fell back.
    return { text: `${payload.text || ''}`.trim(), model: `${payload.model || model}` };
}

/**
 * Whisper ASR Client - Records audio and sends it to the dashboard for transcription
 */
export class WhisperASRClient {
    constructor({ model = DEFAULT_ASR_MODEL, prompt = '', dashboardBaseUrl = '', practiceChatSecret = '' } = {}) {
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.model = model;
        // Tells the model which songs and terms to expect. Empty is fine.
        this.prompt = prompt;
        this.dashboardBaseUrl = dashboardBaseUrl;
        this.practiceChatSecret = practiceChatSecret;

        // Callbacks
        this.onPartialTranscript = null;
        this.onFinalTranscript = null;
        this.onError = null;
    }

    async start() {
        if (!this.dashboardBaseUrl) {
            const error = new Error(NO_DASHBOARD_MESSAGE);
            if (this.onError) this.onError(error);
            throw error;
        }
        try {
            console.log('🎤 Starting Whisper ASR recording...');

            // Get microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // Set up MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            this.audioChunks = [];
            this.isRecording = true;

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                    console.log('📊 Audio chunk collected, size:', event.data.size);
                }
            };

            // Start recording with timeslice to ensure data collection
            this.mediaRecorder.start(1000); // Capture data every 1 second
            console.log('✅ Recording started');

        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            if (this.onError) this.onError(error);
            throw error;
        }
    }

    async stop() {
        try {
            if (!this.mediaRecorder || !this.isRecording) {
                console.log('⚠️ No active recording to stop');
                return;
            }

            console.log('⏹️ Stopping recording...');

            // Show fun processing message
            if (this.onPartialTranscript) {
                this.onPartialTranscript(getRandomProcessingMessage());
            }

            // Stop recording and wait for data
            return new Promise((resolve, reject) => {
                this.mediaRecorder.onstop = async () => {
                    try {
                        console.log('✅ Recording stopped, processing...');
                        this.isRecording = false;

                        if (this.audioChunks.length === 0) {
                            throw new Error('No audio data captured');
                        }

                        // Create audio blob
                        const audioBlob = new Blob(this.audioChunks, {
                            type: 'audio/webm;codecs=opus'
                        });
                        console.log('📦 Audio blob created, size:', audioBlob.size, 'bytes');

                        // Send to Whisper API
                        const transcript = await this.transcribeAudio(audioBlob);

                        // Call final callback
                        if (this.onFinalTranscript) {
                            this.onFinalTranscript(transcript);
                        }

                        // Cleanup
                        this.cleanup();
                        resolve(transcript);

                    } catch (error) {
                        console.error('❌ Transcription failed:', error);
                        if (this.onError) this.onError(error);
                        this.cleanup();
                        reject(error);
                    }
                };

                this.mediaRecorder.stop();
            });

        } catch (error) {
            console.error('❌ Failed to stop recording:', error);
            if (this.onError) this.onError(error);
            this.cleanup();
            throw error;
        }
    }

    async transcribeAudio(audioBlob) {
        try {
            console.log('📤 Sending audio for transcription...');
            const { text, model } = await transcribeViaDashboard({
                dashboardBaseUrl: this.dashboardBaseUrl,
                practiceChatSecret: this.practiceChatSecret,
                audioBlob,
                model: this.model,
                prompt: this.prompt
            });
            this.model = model;
            console.log('✅ Transcription completed');
            return text;
        } catch (error) {
            console.error('❌ Transcription error:', error);
            throw new Error(`Transcription failed: ${error.message}`);
        }
    }

    cleanup() {
        console.log('🧹 Cleaning up resources...');

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
    }
}
