# 🎬 YouTube Automation

A fully automated pipeline that writes short-form video scripts on **any topic you
choose**, narrates them, lays kinetic captions + an optional intro card + background
music over your footage, and uploads to YouTube — completely hands-off, daily.

Out of the box it produces gripping first-person story Shorts, but the niche, tone,
and topics are all configurable (see [Choose your own topic](#-choose-your-own-topic)).

---

## ✨ What it does (the pipeline)

Each run, automatically:

1. **Picks a topic** from your configured pool (or you type one in the dashboard)
2. **Writes the script** with an LLM (Llama 4 Maverick via NVIDIA NIM) — spoken hook line, intro-card question, ~230-260 word narration, 3 title options
3. **Narrates it** with a natural TTS voice (Google Gemini TTS)
4. **Generates kinetic captions** — whisper.cpp word-level timing → bold captions synced to the voice
5. **Builds an intro card** shown for the first few seconds
6. **Assembles the video** — your background footage + card + captions + low music bed (1080×1920, capped at 175s)
7. **Optimises SEO** — title, description, tags, hashtags
8. **Uploads to YouTube** with a generated thumbnail and a first comment

A dashboard at `http://localhost:3456` shows status, view counts, and a **Generate** button (with an optional topic box).

---

## 🚀 Setup Guide

### 1. Prerequisites

```bash
# Node.js 18+, ffmpeg, and whisper.cpp (for caption timing)
brew install node ffmpeg whisper-cpp
```

### 2. Clone & install

```bash
git clone https://github.com/strangedeev/youtube-automation.git
cd youtube-automation
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

Edit `config/credentials.json`:

| Key | Where to get it | Required? |
|-----|-----------------|-----------|
| `youtube.client_id` / `client_secret` | [Google Cloud Console](https://console.cloud.google.com) → Credentials → OAuth client. Enable **YouTube Data API v3**. | ✅ |
| `gemini.apiKey` | [Google AI Studio](https://aistudio.google.com/apikey) | ✅ (TTS) |
| `nvidia.apiKey` | [build.nvidia.com](https://build.nvidia.com) → any model → "Get API Key" (free) | ✅ (script writing) |
| `pexels.apiKey` / `pixabay.apiKey` | Optional stock-footage fallbacks | ⬜ |

> **Important:** In Google Cloud Console → OAuth consent screen, set the app to
> **Production** (not Testing) — Testing-mode refresh tokens expire every 7 days.

### 5. Authenticate with YouTube

```bash
node authenticate.js                 # prints an auth URL
# visit it, authorise, copy the code= value from the redirect URL, then:
node exchange-code.js "PASTE_THE_CODE_HERE"
```

This writes `config/tokens.json`. (Re-run only if you ever see `invalid_grant`.)

### 6. Add background footage & music

- **Backgrounds** → drop `.mp4`/`.webm` clips (≥1080p) into subfolders of `data/gameplay/`
  (e.g. `data/gameplay/clips/`). The picker rotates across all of them randomly.
- **Music** → drop royalty-free `.mp3` files into `data/music/`. Use the
  [YouTube Audio Library](https://www.youtube.com/audiolibrary) — those tracks are
  cleared for monetisation. One is mixed in per video at low volume. (Optional.)

### 7. Run

```bash
node index.js
# or persistently:
npm install -g pm2 && pm2 start index.js --name youtube-automation && pm2 logs youtube-automation
```

Open **http://localhost:3456**, hit **Generate Video Now** (optionally type a topic), or let the daily cron publish automatically.

---

## 🎯 Choose your own topic

The system isn't locked to any niche. To define your own:

```bash
cp config/topics.example.json config/topics.json
```

Edit `config/topics.json`:

```json
{
  "contentStyle": "how every video should sound / its tone and format",
  "category": "Your Niche",
  "topics": [
    "first topic / story premise",
    "second topic",
    "..."
  ]
}
```

- **`contentStyle`** shapes the writing for every video (the tone, format, and feel).
- **`topics`** is the pool the system picks from each run (it avoids recently used ones).
- You can also type a one-off topic directly in the dashboard's topic box.

**Example niches:**

| Niche | `contentStyle` | Example `topics` |
|-------|----------------|------------------|
| Drama stories (default) | `gripping emotional first-person stories that feel real, like a confession` | `"My boss fired me for his own mistake"` |
| Scary stories | `chilling first-person horror stories with a slow build and a terrifying payoff` | `"The night shift at the gas station I'll never forget"` |
| Fun facts | `punchy, surprising fact explainers that hook in the first second` | `"Why your brain deletes most of your memories"` |
| Motivation | `intense, direct motivational monologues that hit hard` | `"Why discipline beats motivation every time"` |
| Life tips | `clear, practical tips delivered fast and confidently` | `"Three money habits that changed my life"` |

If `config/topics.json` is absent, the built-in default story topics are used.

---

## ⚙️ Notes & gotchas

- **ffmpeg without subtitle filters:** captions are rendered as PNG-overlay tracks
  (qtrle alpha), *not* via the `subtitles`/`drawtext` filters — so it works on minimal
  ffmpeg builds. Don't refactor captions to a subtitles filter.
- **Python:** not required. whisper.cpp is a native binary (avoids torch version issues).
- **YouTube Shorts thumbnails:** YouTube often overrides custom thumbnails on Shorts.
  If yours don't stick, set them via the YouTube **mobile app**.
- **Length:** target ~230-260 words (~2 min). Hard-capped at 175s for the Shorts limit.

---

## 🧩 Architecture

| File | Responsibility |
|------|----------------|
| `index.js` | Express dashboard API + pipeline orchestration |
| `agents/content-strategy-agent.js` | Topic selection (`config/topics.json` aware) |
| `agents/script-writer-agent.js` | Script writing via NVIDIA NIM |
| `agents/seo-optimizer-agent.js` | Title, description, tags |
| `agents/production-management-agent.js` | Orchestrates TTS + captions + card + music |
| `agents/publishing-scheduling-agent.js` | YouTube upload, thumbnail, first comment |
| `utils/nim-client.js` | NVIDIA NIM (Llama 4 Maverick) client |
| `utils/caption-renderer.js` | whisper.cpp → transparent caption track |
| `utils/reddit-card.js` | Intro card image |
| `utils/video-assembler.js` | ffmpeg assembly + background rotation |
| `utils/gemini-tts.js` | Gemini TTS |
| `schedules/daily-automation.js` | Daily cron |

---

## 🔐 Security

`config/credentials.json`, `config/tokens.json`, `config/topics.json`, and `.env` are
git-ignored and must **never** be committed. The `*.example.json` files contain
placeholders only.

---

## 📄 License

See [LICENSE](LICENSE).
