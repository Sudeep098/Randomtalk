# 🎥 RandomTalk — Omegle-style Video Chat

Random video chat with strangers. Built with Next.js + WebRTC + Pusher.

## ✨ Features

- **Random video matching** — instantly paired with strangers
- **Interest-based matching** — find people with common interests
- **Live text chat** — side panel chat while video calling
- **Typing indicators** — see when your stranger is typing
- **Next / Stop controls** — move on anytime with one click
- **Mute & Camera toggle** — control your media mid-call
- **Report system** — flag inappropriate users
- **Connection timer** — see how long you've been chatting
- **Network quality indicator** — good/poor signal display
- **Online counter** — see how many people are online

## 🚀 Deploy to Vercel in 5 minutes

### Step 1: Get a free Pusher account

1. Go to [pusher.com](https://pusher.com) → Sign up free
2. Create a new **Channels** app (not Beams)
3. Choose cluster closest to you (e.g. `us2`, `eu`)
4. Copy your **App ID**, **Key**, **Secret**, and **Cluster**

### Step 2: Deploy to Vercel

```bash
# Clone / download this folder, then:
npm install
```

Or push to GitHub and import in Vercel dashboard.

### Step 3: Set environment variables in Vercel

In your Vercel project → Settings → Environment Variables, add:

```
PUSHER_APP_ID         = your_app_id
PUSHER_KEY            = your_key  
PUSHER_SECRET         = your_secret
PUSHER_CLUSTER        = us2

NEXT_PUBLIC_PUSHER_KEY     = your_key
NEXT_PUBLIC_PUSHER_CLUSTER = us2
```

### Step 4: Deploy

```bash
npx vercel --prod
```

Done! 🎉

## 🏗 Architecture

```
Browser A ──── Pusher Signaling ──── Browser B
    │                                    │
    └──────── WebRTC P2P Video ──────────┘
```

- **Signaling**: Pusher Channels (free tier: 200k messages/day, 100 connections)
- **Video/Audio**: WebRTC peer-to-peer (no server bandwidth cost!)
- **STUN**: Google's free STUN servers
- **TURN**: openrelay.metered.ca (free fallback for symmetric NATs)

## 📁 File Structure

```
pages/
  index.js          # Main app UI + WebRTC logic
  api/
    match.js        # Matchmaking endpoint
    signal.js       # WebRTC signaling relay
    chat.js         # Text chat relay
    report.js       # User reporting
lib/
  pusher.js         # Server-side Pusher client
styles/
  globals.css       # Global styles
```

## ⚠️ Limitations (free tier)

- Pusher free: 100 concurrent connections, 200k messages/day
- In-memory waiting pool resets on cold starts (use Redis/Upstash for production scale)
- For 1000+ concurrent users: upgrade Pusher + add Redis

## 🔒 Production Hardening

For a production app, also add:
- Rate limiting on API routes
- Redis (Upstash) for persistent waiting pool
- Age verification / Terms of Service gate
- Auto-ban system based on reports
- Content moderation (e.g., Hive Moderation API)
