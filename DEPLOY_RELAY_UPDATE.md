# Deploy Updated Relay Server to Railway

The relay server needs to be updated to allow Firebase hosting domains to access the API key endpoint.

## Changes Made

Updated `/relay-server/server.js` to allow:
- Firebase hosting domains (`*.firebaseapp.com`, `*.web.app`)
- Localhost testing (`localhost:8000`)

## How to Deploy to Railway

### Option 1: Push via Git (if connected)

```bash
# Navigate to relay server
cd "Desktop/Tools:Games/FC Admin Tools/HW Notes 3 (test1)  copy/relay-server"

# Commit changes
git add server.js
git commit -m "Allow Firebase hosting domains for Practice Chat PWA"
git push

# Railway will auto-deploy
```

### Option 2: Manual Deploy via Railway CLI

```bash
# Install Railway CLI (if not installed)
npm install -g @railway/cli

# Login
railway login

# Navigate to relay server
cd "Desktop/Tools:Games/FC Admin Tools/HW Notes 3 (test1)  copy/relay-server"

# Link to Railway project (first time only)
railway link

# Deploy
railway up
```

### Option 3: Copy & Paste in Railway Dashboard

1. Go to https://railway.app
2. Open your relay server project
3. Click on the service
4. Go to "Settings" → "Source Code"
5. Edit `server.js` directly in Railway dashboard
6. Copy the updated CORS and API key endpoint code
7. Save and Railway will auto-deploy

## Verify Deployment

After deployment, test the endpoint:

```bash
curl https://enhanced-music-lesson-notes-production.up.railway.app/health
```

Should return:
```json
{"status":"ok","timestamp":"2024-12-30T..."}
```

---

## Note

The relay server is already deployed at:
`https://enhanced-music-lesson-notes-production.up.railway.app`

You just need to push the updated `server.js` file.
