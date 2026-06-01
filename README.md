# 🎬 Behind Closed Doors — Automated YouTube Shorts Engine

A fully automated pipeline that writes **original first-person drama stories**,
narrates them, lays kinetic captions + a Reddit-style intro card + background music
over gameplay/lifestyle footage, and uploads to YouTube — completely hands-off, daily.

Built in the style of channels like @Broken.Stories: short, emotionally gripping,
original stories (betrayal, family secrets, revenge) that keep viewers watching.

---

## ✨ What it does (the pipeline)

Each run, automatically:

1. **Picks a story premise** from a categorised pool (relationship betrayal, family drama, workplace injustice, etc.)
2. **Writes an original story** with Llama 4 Maverick (NVIDIA NIM) — spoken hook line, AskReddit-style card question, ~230-260 word narration, 3 title options
3. **Narrates it** with the Aoede voice (Google Gemini TTS)
4. **Generates kinetic captions** — whisper.cpp word-level timing → bold yellow/black captions synced to the voice
5. **Builds a Reddit-style intro card** shown for the first 5 seconds
6. **Assembles the video** — random gameplay/lifestyle background + card + captions + low music bed (1080×1920, capped at 175s)
7. **Optimises SEO** — title, description (with anonymity disclaimer), 3-bucket tags, hashtags
8. **Uploads to YouTube** with an AI thumbnail and an engagement-bait first comment

A dashboard at `http://localhost:3456` shows status, view counts, and a manual "Generate" button.

---

## 🧩 Architecture

| Layer | File | Responsibility |
|-------|------|----------------|
| Server / orchestration | `index.js` | Express dashboard API + `generateContent()` pipeline |
| Story premise | `agents/content-strategy-agent.js` | `selectStoryPremise()` |
| Story writing | `agents/script-writer-agent.js` | `generateOriginalStory()` via NIM |
| SEO | `agents/seo-optimizer-agent.js` | Title, description, tags, hashtags |
| Production | `agents/production-management-agent.js` | Orchestrates TTS + captions + card + music |
| Publishing | `agents/publishing-scheduling-agent.js` | YouTube upload, thumbnail, first comment |
| LLM client | `utils/nim-client.js` | NVIDIA NIM (Llama 4 Maverick) |
| Captions | `utils/caption-renderer.js` | whisper.cpp → transparent caption track |
| Reddit card | `utils/reddit-card.js` | Intro card PNG (sharp/SVG) |
| Video | `utils/video-assembler.js` | ffmpeg assembly + background rotation |
| TTS | `utils/gemini-tts.js` | Gemini TTS (Aoede) |
| Schedule | `schedules/daily-automation.js` | Cron (daily) |

---

## 🚀 Setup Guide

### 1. Prerequisites

Install these first (macOS shown; use your platform's equivalents):

```bash
# Node.js 18+ and ffmpeg
brew install node ffmpeg

# whisper.cpp (for caption timing)
brew install whisper-cpp
```

### 2. Clone & install

```bash
git clone https://github.com/strangedeev/behind-closed-doors.git
cd behind-closed-doors
npm install
```

### 3. Download the Whisper model (for captions)

```bash
mkdir -p models
curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

### 4. Add your API keys

```bash
cp config/credentials.example.json config/credentials.json
```

Then edit `config/credentials.json` and fill in:

| Key | Where to get it | Required? |
|-----|-----------------|-----------|
| `youtube.client_id` / `client_secret` | [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client (Desktop/Web). Enable **YouTube Data API v3**. | ✅ |
| `gemini.apiKey` | [Google AI Studio](https://aistudio.google.com/apikey) | ✅ (TTS) |
| `nvidia.apiKey` | [build.nvidia.com](https://build.nvidia.com) → any model → "Get API Key" (free) | ✅ (story writing) |
| `pexels.apiKey` / `pixabay.apiKey` | Optional stock-footage fallbacks | ⬜ |

> **Important:** In Google Cloud Console → OAuth consent screen, set the app to
> **Production** (not Testing). Testing-mode refresh tokens expire every 7 days.

### 5. Authenticate with YouTube

```bash
node authenticate.js
```

Visit the printed URL, authorise, and copy the `code=` value from the redirect URL.
Then exchange it for a token:

```bash
node exchange-code.js "PASTE_THE_CODE_HERE"
```

This writes `config/tokens.json`. (Re-run only if you ever see an `invalid_grant` error.)

### 6. Add background footage & music

- **Backgrounds** → drop `.mp4`/`.webm` clips (≥1080p) into subfolders of `data/gameplay/`
  (e.g. `data/gameplay/subway/`, `data/gameplay/lifestyle/`). The picker rotates across all of them.
- **Music** → drop royalty-free `.mp3` files into `data/music/`. Use the
  [YouTube Audio Library](https://www.youtube.com/audiolibrary) — those tracks are
  cleared for monetisation (no Content-ID claims). One is mixed in per video at 12% volume.

### 7. Run

```bash
# Run directly
node index.js

# Or run persistently with PM2
npm install -g pm2
pm2 start index.js --name behind-closed-doors
pm2 logs behind-closed-doors
```

Open the dashboard at **http://localhost:3456** and hit **Generate Video Now**, or let
the daily cron publish automatically.

---

## ⚙️ Notes & gotchas

- **ffmpeg without subtitle filters:** captions are rendered as PNG-overlay tracks
  (qtrle alpha), *not* via the `subtitles`/`drawtext` filters — so it works even on
  minimal ffmpeg builds. Don't refactor captions to a subtitles filter.
- **Python:** not required for the pipeline. whisper.cpp is a native binary, which
  avoids Python/torch version issues.
- **YouTube Shorts thumbnails:** YouTube often overrides custom thumbnails on Shorts.
  If yours don't stick, set them via the YouTube **mobile app**.
- **Story length:** target ~230-260 words (~2 min). Hard-capped at 175s in the assembler
  to stay within the Shorts limit.

---

## 🔐 Security

`config/credentials.json`, `config/tokens.json`, and `.env` are git-ignored and must
**never** be committed. The example file (`config/credentials.example.json`) contains
placeholders only.

---

## 📄 License

See [LICENSE](LICENSE).
