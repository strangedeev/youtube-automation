/**
 * sync-youtube.js
 * Checks every "published" video in the local DB against the YouTube API.
 * Any video that no longer exists on YouTube gets marked "deleted" in the DB
 * so the dashboard shows the correct live count.
 *
 * Usage: node sync-youtube.js
 */

const { google } = require('googleapis');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const { CredentialManager } = require('./utils/credential-manager');

async function syncWithYouTube() {
  // ── Load credentials & YouTube client ───────────────────────────────
  const cm = new CredentialManager();
  await cm.initialize();
  const auth = cm.getYouTubeAuth();
  const youtube = google.youtube({ version: 'v3', auth });

  // ── Open DB ───────────────────────────────────────────────────────────
  const dbPath = path.join(__dirname, 'data', 'youtube_automation.db');
  const db = new sqlite3.Database(dbPath);

  const dbAll = (sql) => new Promise((resolve, reject) =>
    db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows))
  );
  const dbRun = (sql, params) => new Promise((resolve, reject) =>
    db.run(sql, params, (err) => err ? reject(err) : resolve())
  );

  // Get all published video IDs
  const rows = await dbAll(
    "SELECT id, youtube_id, title FROM publish_schedule WHERE status = 'published' AND youtube_id IS NOT NULL"
  );

  console.log(`Checking ${rows.length} published videos against YouTube API...`);

  // YouTube API accepts up to 50 IDs per request — batch them
  const BATCH = 50;
  const deletedIds = [];
  const stillLiveIds = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const ids = batch.map(r => r.youtube_id).join(',');

    try {
      const res = await youtube.videos.list({ part: 'id,snippet', id: ids });
      const foundIds = new Set((res.data.items || []).map(v => v.id));

      for (const row of batch) {
        if (foundIds.has(row.youtube_id)) {
          stillLiveIds.push(row.youtube_id);
        } else {
          deletedIds.push({ id: row.id, youtube_id: row.youtube_id, title: row.title });
        }
      }
    } catch (err) {
      console.error(`API error on batch ${i / BATCH + 1}:`, err.message);
    }
  }

  // ── Update DB ────────────────────────────────────────────────────────
  const updateStmt = db.prepare(
    "UPDATE publish_schedule SET status = 'deleted' WHERE id = ?"
  );

  if (deletedIds.length > 0) {
    console.log(`\nFound ${deletedIds.length} video(s) deleted from YouTube:`);
    for (const v of deletedIds) {
      console.log(`  • [${v.youtube_id}] ${v.title}`);
      await dbRun("UPDATE publish_schedule SET status = 'deleted' WHERE id = ?", [v.id]);
    }
    console.log(`\nMarked ${deletedIds.length} video(s) as "deleted" in the database.`);
  } else {
    console.log('\nNo deleted videos found — database is already in sync.');
  }

  console.log(`\nSummary:`);
  console.log(`  Still live on YouTube : ${stillLiveIds.length}`);
  console.log(`  Marked as deleted     : ${deletedIds.length}`);
  console.log(`  New "published" count : ${stillLiveIds.length}`);

  db.close();
  console.log('\nDone. Refresh your dashboard to see the updated count.');
}

syncWithYouTube().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
