# Practice Chat PWA 🎵

Progressive Web App for capturing lesson conversations and practice reflections.

**Status**: ✅ Live in Production
**Version**: 1.0.0
**Live URL**: https://practice-chat-pwa.web.app
**Converted from**: HW Notes 3 Chrome Extension

---

## 🎯 What Is This?

A browser-based voice recording app for music teachers to quickly capture lesson notes. Speak naturally about the lesson, and the app will:

1. **Transcribe** your speech in real-time (using OpenAI Realtime API)
2. **Clean up** filler words and grammar
3. **Format** professional lesson summaries
4. **Save** notes to copy into lesson management systems

---

## ✨ Features

- ✅ **Cloud Speech Recognition**: Real-time transcription via WebSocket
- ✅ **Text Processing**: Removes "um", "uh", fixes grammar, music terminology
- ✅ **Local Storage**: Automatically saves your last notes (24h)
- ✅ **Copy to Clipboard**: One-click copy for pasting into emails/systems
- ✅ **PWA**: Installable on desktop and mobile
- ✅ **Offline Support**: Service worker caches app for offline use

---

## 🏗️ Architecture

```
Practice Chat PWA
├── Frontend (PWA)
│   ├── index.html          # Main UI
│   ├── css/styles.css      # Styling
│   └── src/
│       ├── app.js          # Main app logic
│       ├── practice-note-sync.js # Optional dashboard snapshot handoff
│       ├── asr-client.js   # Speech recognition
│       └── text-processor.js # Text cleanup
│
└── Backend (Railway)
    └── relay-server/       # WebSocket relay to OpenAI
        └── server.js       # (Already deployed)
```

**Backend**: `wss://enhanced-music-lesson-notes-production.up.railway.app/realtime`

---

## 🚀 Quick Start

### Option 1: Test Locally (Simple)

```bash
# Navigate to project
cd "Desktop/Tools:Games/FC Admin Tools/Practice Chat PWA/public"

# Start a local server (Python)
python3 -m http.server 8000

# Or use Node.js
npx http-server -p 8000

# Open browser
open http://localhost:8000
```

**Note**: For microphone access, you need HTTPS in production. Local testing works on localhost.

### Option 2: Deploy to Firebase (Recommended)

```bash
# Install Firebase CLI (if not already installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Navigate to project root
cd "Desktop/Tools:Games/FC Admin Tools/Practice Chat PWA"

# Initialize Firebase (if first time)
firebase init hosting
# Select: Use existing project
# Choose: practice-chat-pwa (or create new)
# Public directory: public
# Single-page app: Yes
# GitHub deploys: No

# Deploy to Firebase
firebase deploy --only hosting

# Your app will be live at:
# https://practice-chat-pwa.web.app
```

---

## 📱 Installation (PWA)

Once deployed, users can install the app:

### Desktop (Chrome/Edge)
1. Visit the deployed URL
2. Click the "Install" button in the address bar
3. App opens in standalone window

### Mobile (iOS Safari)
1. Visit the deployed URL
2. Tap Share button
3. Tap "Add to Home Screen"
4. App appears on home screen like a native app

### Mobile (Android Chrome)
1. Visit the deployed URL
2. Tap menu (3 dots)
3. Tap "Install app" or "Add to Home Screen"

---

## 🎤 How to Use

1. **Click "Start Recording"** - Grant microphone permission
2. **Speak naturally** about the lesson
3. **Watch live transcript** appear in real-time
4. **Click "Stop Recording"** when done
5. **Review processed notes** - cleaned up and formatted
6. **Edit if needed** - the final note box is editable before copying
7. **Click "Copy Notes"** - paste into your lesson system
8. **Click "Take Attendance"** - opens MMS so the tutor can mark attendance and send the parent email

---

## 🔧 Technical Details

### Technologies Used
- **Frontend**: Vanilla JavaScript (ES6 modules), HTML5, CSS3
- **Speech Recognition**: OpenAI Realtime API (via WebSocket relay)
- **Hosting**: Firebase Hosting (or any static host)
- **Backend**: Railway (existing relay server, no changes needed)
- **PWA**: Service Worker, Web App Manifest

### Browser Requirements
- **Chrome/Edge**: Full support ✅
- **Safari**: Full support (with mic permission) ✅
- **Firefox**: Full support ✅
- **Mobile**: Works on all modern mobile browsers ✅

### Storage
- **localStorage**: Saves last notes (clears after 24 hours)
- **Dashboard snapshot**: When opened from a dashboard student link, clicking `Take Attendance` sends a best-effort copy to the dashboard `Practice_Notes_Log` tab before opening MMS
- **MMS remains completion truth**: Tutors still mark attendance and send parent notes manually in MMS

---

## 🔒 Privacy & Security

- **Microphone**: Only used during active recording, immediately released
- **Transcription**: Processed via OpenAI API through secure relay
- **Storage**: Notes are stored locally in the browser. If opened from a dashboard student link, the generated note is also sent to the private dashboard as an append-only snapshot.
- **No tracking**: No analytics, no cookies, no user tracking

---

## Dashboard Handoff

Dashboard quick links can open Practice Chat with context:

```text
https://practice-chat-pwa.web.app/?studentId=sdt_123&studentName=Ada%20Lovelace&tutor=Dean&dashboardBaseUrl=https%3A%2F%2Fdashboard.example
```

When those parameters are present, `Take Attendance` posts to:

```text
{dashboardBaseUrl}/api/practice-notes
```

The save is best-effort. If the dashboard snapshot fails, the app warns in the console/UI but still opens MMS. This preserves the tutor workflow.

Rollback path: revert the dashboard `Practice_Notes_Log` commit and this PWA handoff commit. The older copy/open-MMS flow does not depend on the snapshot endpoint.

---

## 📝 Differences from Chrome Extension

| Feature | Extension | PWA |
|---------|-----------|-----|
| **Installation** | Chrome Web Store | Just visit URL |
| **Platform** | Desktop Chrome only | Desktop + Mobile (all browsers) |
| **Updates** | Manual approval | Instant |
| **Access** | Browser toolbar | Bookmark or home screen |
| **Offline** | Limited | Full PWA support |
| **UI** | 350px popup | Full responsive page |

---

## 🛠️ Development

### Project Structure
```
Practice Chat PWA/
├── public/                 # All web files
│   ├── index.html         # Main page
│   ├── manifest.json      # PWA manifest
│   ├── service-worker.js  # Offline support
│   ├── css/
│   │   └── styles.css     # All styles
│   ├── src/               # JavaScript modules
│   │   ├── app.js         # Main app
│   │   ├── practice-note-sync.js # Dashboard snapshot helper
│   │   ├── asr-client.js  # Speech recognition
│   │   └── text-processor.js # Text cleanup
│   └── icons/             # PWA icons
├── firebase.json          # Firebase config
├── .firebaserc            # Firebase project
└── README.md             # This file
```

### Making Changes
1. Edit files in `public/`
2. Run tests: `npm test`
3. Test locally: `python3 -m http.server 8000 --directory public`
4. Deploy: `firebase deploy --only hosting`

---

## 🚀 Deployment Options

### Firebase Hosting (Recommended) ⭐
- **Pros**: Free, automatic HTTPS, CDN, easy deployment
- **Cost**: $0 (generous free tier)
- **Setup**: 5 minutes with Firebase CLI
- **Command**: `firebase deploy`

### Railway
- **Pros**: Backend already there, can host frontend too
- **Cost**: $0-5/month
- **Setup**: Connect GitHub repo, auto-deploy

### Vercel/Netlify
- **Pros**: Free, automatic deployments, great DX
- **Cost**: $0
- **Setup**: Connect GitHub, auto-deploy on push

### WordPress/GoDaddy
- **Pros**: You already have it
- **Cons**: More complex setup, manual file uploads
- **Not recommended** unless needed for other reasons

---

## 🐛 Troubleshooting

### "Microphone not working"
- Ensure HTTPS (required for mic access)
- Check browser permissions
- Try different browser

### "Connection timeout"
- Check Railway relay server is running
- Verify RELAY_WSS_URL in asr-client.js
- Check browser console for errors

### "Service worker not updating"
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- Clear browser cache
- Increment CACHE_NAME in service-worker.js

---

## 📈 Next Steps (Future Enhancements)

- [ ] Add browser ASR fallback (Web Speech API) if relay unavailable
- [ ] Export notes as PDF/text file
- [ ] Multiple lesson templates (structured questions)
- [ ] Integration with MyMusicStaff API
- [ ] Student name autocomplete
- [ ] Note history/archive

---

## 🤝 Support

Built for First Chord Music School teachers.

For issues or questions, contact Finn.

---

**Practice Chat PWA** - From lesson to notes in 60 seconds! 🎵
