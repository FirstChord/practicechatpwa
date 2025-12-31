// Practice Chat - ASR Client Module
// Handles speech recognition via Whisper API (batch processing)

const RELAY_SERVER = 'https://enhanced-music-lesson-notes-production.up.railway.app';

// Fun processing messages while transcribing
const PROCESSING_MESSAGES = [
    "🐺 A pack of wolves are raising your notes...",
    "🍳 Making a note omelette...",
    "📝 Taking note of your notes",
    "🎭 Dramatic pause...",
    "🔮 Consulting the crystal ball of transcription...",
    "🚀 Launching words into orbit...",
    "🧙‍♂️ Casting spelling spells...",
    "🎪 Training circus words to perform...",
    "🍕 Adding extra cheese to your notes...",
    "🦄 Unicorns are polishing your words...",
    "🎵 Walking 500 miles...",
    "✨ Processing how incredibly good your notes are..."
];

function getRandomProcessingMessage() {
    return PROCESSING_MESSAGES[Math.floor(Math.random() * PROCESSING_MESSAGES.length)];
}

/**
 * Whisper ASR Client - Records audio and sends to Whisper API for transcription
 */
export class WhisperASRClient {
    constructor() {
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;

        // Callbacks
        this.onPartialTranscript = null;
        this.onFinalTranscript = null;
        this.onError = null;
    }

    async start() {
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
            console.log('📤 Sending audio to Whisper API...');

            // Get API key from relay server
            const apiKey = await this.getAPIKey();

            // Prepare form data
            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.webm');
            formData.append('model', 'whisper-1');
            formData.append('response_format', 'json');

            // Send to Whisper API
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
            }

            const result = await response.json();
            console.log('✅ Whisper transcription completed:', result.text);

            return result.text.trim();

        } catch (error) {
            console.error('❌ Whisper API error:', error);
            throw new Error(`Transcription failed: ${error.message}`);
        }
    }

    async getAPIKey() {
        try {
            console.log('🔑 Fetching API key from relay server...');

            const response = await fetch(`${RELAY_SERVER}/api-key`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get API key: ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ API key retrieved');
            return data.apiKey;

        } catch (error) {
            console.error('❌ Failed to get API key:', error);
            throw new Error('Could not retrieve API key for Whisper transcription');
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
