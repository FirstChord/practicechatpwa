# Firebase Setup & Auto-Deploy Guide

This guide will help you deploy Practice Chat PWA to Firebase Hosting and set up auto-deploy from GitHub.

---

## ✅ What's Already Done

- ✅ Firebase CLI installed locally
- ✅ `firebase.json` configured
- ✅ `.firebaserc` with project ID
- ✅ GitHub Actions workflows created
- ✅ Repository pushed to GitHub

---

## 🚀 Step 1: Manual Deploy to Firebase (First Time)

### 1.1 Login to Firebase

```bash
cd "/Users/finnlemarinel/Desktop/Tools:Games/FC Admin Tools/Practice Chat PWA"
npx firebase login
```

This will open your browser and ask you to login with your Google account.

### 1.2 Verify Firebase Project

Check if the Firebase project exists:

```bash
npx firebase projects:list
```

If `practice-chat-pwa` is **not** in the list, create it:

```bash
npx firebase projects:create practice-chat-pwa
```

Or use the Firebase Console: https://console.firebase.google.com/

### 1.3 Deploy to Firebase Hosting

```bash
npm run deploy
```

Or:

```bash
npx firebase deploy --only hosting
```

**Your app will be live at**: https://practice-chat-pwa.web.app

---

## 🤖 Step 2: Set Up Auto-Deploy from GitHub

### 2.1 Generate Firebase Service Account

```bash
npx firebase login:ci
```

This will:
1. Open browser for authentication
2. Generate a CI token
3. Display the token in your terminal

**⚠️ IMPORTANT**: Copy the token! It looks like: `1//abc123def456...`

### 2.2 Add Token to GitHub Secrets

1. Go to your GitHub repository: https://github.com/FirstChord/practicechatpwa

2. Click **Settings** → **Secrets and variables** → **Actions**

3. Click **New repository secret**

4. Name: `FIREBASE_SERVICE_ACCOUNT_PRACTICE_CHAT_PWA`

5. Value: Paste the token from step 2.1

6. Click **Add secret**

### 2.3 Test Auto-Deploy

Make a small change and push:

```bash
cd "/Users/finnlemarinel/Desktop/Tools:Games/FC Admin Tools/Practice Chat PWA"

# Edit README or make any small change
echo "# Test deployment" >> README.md

# Commit and push
git add .
git commit -m "Test auto-deploy"
git push
```

Go to: https://github.com/FirstChord/practicechatpwa/actions

You should see the workflow running! 🎉

When it completes, your changes will be live at https://practice-chat-pwa.web.app

---

## 📝 Alternative: Set Up Service Account (Recommended for Production)

Instead of using a CI token, use a service account for better security:

### 1. Create Service Account

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select `practice-chat-pwa` project
3. Click ⚙️ (Settings) → **Project settings**
4. Go to **Service accounts** tab
5. Click **Generate new private key**
6. Download the JSON file

### 2. Add to GitHub Secrets

1. Open the downloaded JSON file
2. Copy the **entire contents**
3. Go to GitHub repo → Settings → Secrets → Actions
4. Create new secret: `FIREBASE_SERVICE_ACCOUNT_PRACTICE_CHAT_PWA`
5. Paste the entire JSON contents
6. Save

---

## 🎯 How Auto-Deploy Works

Once set up, every time you push to `main`:

1. GitHub Actions runs automatically
2. Builds and deploys to Firebase Hosting
3. Your app is updated at https://practice-chat-pwa.web.app
4. Takes ~1-2 minutes total

**Workflow files**:
- `.github/workflows/firebase-hosting-main.yml` - Deploys on push to main
- `.github/workflows/firebase-hosting-pull-request.yml` - Creates preview for PRs

---

## 🛠️ Useful Commands

### Deploy manually
```bash
npm run deploy
```

### Check Firebase projects
```bash
npx firebase projects:list
```

### View hosting info
```bash
npx firebase hosting:channel:list
```

### Open hosting URL
```bash
npx firebase hosting:channel:open live
```

### Run locally
```bash
npm run dev
# Then open http://localhost:8000
```

---

## 🔥 Firebase Project Details

- **Project ID**: `practice-chat-pwa`
- **Hosting URL**: https://practice-chat-pwa.web.app
- **Console**: https://console.firebase.google.com/project/practice-chat-pwa

---

## ⚠️ Troubleshooting

### "Project not found"

Make sure the project exists in Firebase:
```bash
npx firebase projects:create practice-chat-pwa
```

### "Permission denied"

Re-login:
```bash
npx firebase logout
npx firebase login
```

### GitHub Actions failing

1. Check secrets are set correctly
2. Verify service account has "Firebase Hosting Admin" role
3. Check workflow logs: https://github.com/FirstChord/practicechatpwa/actions

---

## 🎉 Next Steps

After deployment:

1. ✅ Test the live app at https://practice-chat-pwa.web.app
2. ✅ Test recording and transcription
3. ✅ Deploy relay server updates to Railway
4. ✅ Install as PWA on your phone (Add to Home Screen)

---

Ready to deploy! Run:

```bash
npx firebase login
npm run deploy
```
