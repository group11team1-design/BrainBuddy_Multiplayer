# BrainBuddy — Real Room-Code Multiplayer

BrainBuddy is a Vercel-hosted static frontend with a Render-hosted Flask + Socket.IO backend and PostgreSQL database.

## Features
- Create a room and receive a shareable room code.
- Join the same room from another browser/device with that code.
- Live joined-member list (online status updates when sockets connect/disconnect).
- Shared room chat, persisted in PostgreSQL.
- Reconnect support using a browser-generated client ID.
- No Supabase required.

## Deploy in this order

### 1. Deploy backend + PostgreSQL on Render
1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint** and select the repository. Render reads `render.yaml`.
3. Approve creation of the `brainbuddy-api` web service and `brainbuddy-db` PostgreSQL database.
4. Wait for the web service to deploy. Copy its public URL, e.g. `https://brainbuddy-api.onrender.com`.
5. In the Render service's Environment settings, set `FRONTEND_ORIGINS` to your Vercel URL once deployed (step 2), for example `https://brainbuddy.vercel.app`. You can temporarily set `*` for initial testing, but use your exact origin for normal use. Save/redeploy.

**If you prefer manual setup:** create a PostgreSQL database on Render, then create a Python web service from the `backend` directory. Build command: `pip install -r requirements.txt`; start command: `gunicorn --worker-class gthread --threads 100 --timeout 120 app:app`. Set `DATABASE_URL` to the database's **Internal Database URL** when the web service is on Render, and set `FRONTEND_ORIGINS` to the Vercel origin.

### 2. Deploy frontend on Vercel
1. In Vercel, import the same GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Framework preset: **Other**. No build command. Output directory: `.`.
4. Deploy.
5. Open `frontend/config.js` in GitHub and replace `https://YOUR-RENDER-SERVICE.onrender.com` with your actual Render service URL (no trailing slash). Commit the change; Vercel will redeploy.
6. Copy your Vercel production URL and add it to Render's `FRONTEND_ORIGINS` environment variable. Save and redeploy the backend.

If your Vercel project has a custom domain, include that origin too, comma-separated, e.g. `https://brainbuddy.vercel.app,https://play.example.com`.

## Test with two members
1. Open the deployed Vercel site in browser A and enter a display name.
2. Click **Create room** and copy the room code.
3. Open the site in browser B (or another device), enter a different display name, enter that exact room code, and click **Join room**.
4. Both screens should show both members. Send a chat message from one screen; it should appear on the other.

For a reliable test, use two different browser profiles/devices. Opening two tabs in the same browser is okay, but they share the same browser storage identity unless you use separate profiles.

## Important deployment notes
- Render free web services can sleep after inactivity, so the first connection can take a little while.
- Keep a single Render web-service instance for this Socket.IO in-memory presence implementation. PostgreSQL persists rooms, members, and messages, but online socket presence is tracked by the running service. If you later scale to multiple instances, add a Socket.IO Redis message queue/adapter.
- The backend uses simple anonymous display names, not secure account authentication. Do not use it for sensitive/private conversations. Room codes are unguessable enough for a casual game but are not an authorization system.
- This project persists chat messages and member records in PostgreSQL. There is no automatic message deletion; add retention controls before public production use.
- Do not put PostgreSQL credentials in frontend files. Only the public backend URL belongs in `frontend/config.js`.
- This project is prepared for deployment but has not been tested against your live Render/Vercel accounts or on real devices.

## Local backend run
```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DATABASE_URL="sqlite:///brainbuddy.db"
$env:FRONTEND_ORIGINS="http://127.0.0.1:5500,http://localhost:5500"
python app.py
```
Serve `frontend` with a static server on port 5500 (for example, Python's built-in server from that folder: `python -m http.server 5500`). Set `frontend/config.js` to `http://127.0.0.1:5000` while testing locally.
