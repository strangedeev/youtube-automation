# Behind Closed Doors — Project Handoff

_Last updated: 2026-05-29_

A fully automated YouTube Shorts channel that generates **original first-person
drama stories** (betrayal, family secrets, revenge), narrates them, lays kinetic
captions + a Reddit-style intro card + music over gameplay/lifestyle backgrounds,
and uploads to YouTube — hands-off, daily.

Formerly "Vid Shock" (shocking-facts format). Rebranded to **Behind Closed Doors**
with an original-story format modelled on channels like @Broken.Stories.

---

## Current State: Phase 1 + Phase 2 COMPLETE ✅

The full pipeline runs end-to-end and uploads live. Verified working examples:
- https://www.youtube.com/watch?v=AD5W9mLNzH8 (full package: story + voice + captions + card + music)

### How a video gets made (the pipeline)
1. **Content strategy** picks an original story premise (categorised pool) — `agents/content-strategy-agent.js` → `selectStoryPremise()`
2. **Script writer** sends the premise to **Llama 4 Maverick (NVIDIA NIM)** which writes the full original story package: spoken hook line, AskReddit-style card question, 230-260 word narration, 3 title options — `agents/script-writer-agent.js` → `generateOriginalStory()`
3. **TTS** narrates with the **Aoede** voice (Gemini 2.5 Flash TTS) — `utils/gemini-tts.js`
4. **Captions** — whisper.cpp transcribes the audio to word timings → builds a transparent kinetic caption track (yellow fill, black outline, Montserrat Black) — `utils/caption-renderer.js`
5. **Reddit card** — white rounded intro card (@Behind Closed Doors + the question) — `utils/reddit-card.js`
6. **Video assembly** — random background (gameplay OR lifestyle clip) + card overlay (first 5s) + caption track + music bed (12% vol), capped 175s — `utils/video-assembler.js` → `assemble()` (brainrot branch)
7. **SEO** — title, description (with anonymity disclaimer + "full story, no part 2"), 3-bucket tags, hashtags — `agents/seo-optimizer-agent.js`
8. **Upload** — video + AI thumbnail + first comment (Reddit-drama engagement hooks) — `agents/publishing-scheduling-agent.js`

Runs daily at 12pm via cron (`schedules/daily-automation.js`). Managed by PM2 as `vid-shock`. Dashboard at http://localhost:3456.

---

## Key Files

| File | Role |
|------|------|
| `index.js` | Express server, dashboard API, `generateContent()` pipeline orchestration, `/status` live progress |
| `agents/content-strategy-agent.js` | `selectStoryPremise()` — categorised original-story premise pool |
| `agents/script-writer-agent.js` | `generateOriginalStory()` — NIM/Llama 4 Maverick full story package |
| `agents/seo-optimizer-agent.js` | Title/description/tags, Shorts-calibrated SEO score |
| `agents/production-management-agent.js` | `assembleVideo()` — orchestrates captions + card + music into assembly |
| `agents/publishing-scheduling-agent.js` | YouTube upload, thumbnail, first comment |
| `utils/nim-client.js` | NVIDIA NIM (Llama 4 Maverick) OpenAI-compatible client |
| `utils/caption-renderer.js` | whisper.cpp → word timings → transparent caption-track .mov |
| `utils/reddit-card.js` | Reddit-style intro card PNG (sharp/SVG) |
| `utils/video-assembler.js` | ffmpeg assembly; `pickLocalGameplayClip()` rotates all of `data/gameplay/**` |
| `utils/gemini-tts.js` | Gemini TTS, voice = Aoede |
| `schedules/daily-automation.js` | Cron schedule (12pm daily) |
| `exchange-code.js` | One-off: exchange a Google OAuth code → tokens (see Auth below) |
| `sync-youtube.js` | Reconcile DB published-count against actual live YouTube videos |

### Data / assets
- `data/gameplay/**` — background clips. Subfolders: `subway/`, `minecraft/`, `other/`, `lifestyle/`. Picker uses any clip ≥1080p across all subfolders at random.
- `data/music/` — background music (3 YouTube-Audio-Library tracks). Any `.mp3/.m4a/.wav/.aac` auto-detected & mixed at 12%.
- `models/ggml-base.en.bin` — whisper.cpp model for captions.
- `assets/fonts/Montserrat-Black.ttf` — caption + card font.
- `config/credentials.json` — all keys (youtube, gemini, **nvidia**, pexels, pixabay) + `channel` branding.
- `config/tokens.json` — YouTube OAuth tokens.

---

## Config & Accounts

- **NVIDIA NIM key**: stored in `config/credentials.json` → `nvidia.apiKey`. Free tier, model `meta/llama-4-maverick-17b-128e-instruct`.
- **Gemini key**: TTS (Aoede) + legacy fallback writer.
- **Channel**: name "Behind Closed Doors", branding in `config/credentials.json` → `channel`. Banner + profile pic uploaded manually in Studio.
- **YouTube OAuth**: app is now in **Production** mode (Google Cloud Console → Auth Platform), so refresh tokens no longer expire every 7 days. If `invalid_grant` ever returns: run the auth flow, grab the `code=` from the redirect URL, then `node exchange-code.js "<code>"`.

---

## Dependencies (installed)
- `ffmpeg` 8.1.1 (homebrew) — NOTE: this build has **no `subtitles`/`drawtext`/`ass` filters**. Captions are done via PNG-overlay (qtrle alpha track), NOT subtitle filters. Don't "simplify" to a subtitles filter — it will fail on this build.
- `whisper-cli` (whisper.cpp via brew) — word-level timestamps.
- Node deps: `sharp`, `axios`, `googleapis`, `@google/generative-ai`, `sqlite3`.
- Python 3.14 (too new for openai-whisper/torch — that's why we use whisper.cpp).

---

## Master List — Status

| # | Item | Status |
|---|------|--------|
| 1 | Original AI stories (no Reddit fetch) | ✅ |
| 2 | Opening spoken hook line | ✅ |
| 3 | Reddit intro card overlay (first 5s) | ✅ |
| 4 | Burned-in kinetic captions (yellow/black) | ✅ |
| 5 | Two title formulas (cliffhanger / question) | ✅ |
| 6 | Anonymity disclaimer in description | ✅ |
| 7 | Lifestyle + gameplay backgrounds (random) | ✅ |
| 8 | Background music bed | ✅ |
| 9 | Switched LLM → Llama 4 Maverick (NIM) | ✅ |
| 10 | Channel rename → Behind Closed Doors | ✅ |
| 11 | Channel description rewrite | ✅ |
| 12 | Dashboard rebrand | ✅ |
| 13 | Voice → Aoede | ✅ |
| 14 | YouTube OAuth → Production (no 7-day expiry) | ✅ |

---

## Where We Left Off — PICK UP HERE

The channel is fully built and publishing daily on the new format. Two things are
intentionally **deferred**:

### 1. Let it run & watch performance (do this first)
Let the new format run **2-3 weeks** to build a library (~20-30 videos) and some
subscribers before changing anything. Decide next moves on data, not guesses.
- _Optional build:_ a weekly performance check that flags best/worst performers
  (pulls views/retention via YouTube API) so the Phase 3 call is data-driven.

### 2. Phase 3 — Cliffhanger funnel + long-form (deferred, NOT started)
The BrokenStories growth mechanic. **Hold until there's an audience** — telling
viewers to leave a Short hurts completion rate (the #1 Shorts ranking signal), so
it only pays off once a library + audience habit exist.

**Decisions needed before building:**
- Long-form format: vertical 9:16 or landscape 16:9?
- Cliffhanger cut: true mid-story cut, or stop just before the final twist?
- CTA placement: pinned comment, description link, or both?

**What to build:**
1. Story generator: produce full longer story + mark the cliffhanger cut point.
2. Long-form assembly path (no 175s cap, regular video not a Short).
3. Upload orchestration: long-form uploads FIRST → capture its URL → Short generates with CTA pointing to it → Short uploads.
4. CTA injection: spoken outro + description link + pinned comment.

### 3. Smaller open item
- ~27 old "Vid Shock" videos (old facts + early Reddit) clash with the new brand.
  Consider setting the off-brand ones to **Private** (not delete — keeps data) so
  the channel reads coherently to new visitors. `sync-youtube.js` can help list them.

---

## Operational Notes
- Restart after code changes: `pm2 restart vid-shock`
- Logs: `pm2 logs vid-shock`
- Manual generate: dashboard "Generate Video Now" button, or `POST /generate`
- Thumbnails: AI-generated + uploaded, BUT YouTube Shorts often overrides custom
  thumbnails — set them via the **YouTube mobile app** if they don't stick.
- Story length target ~230-260 words (~2 min). Hard cap 175s in the assembler.
