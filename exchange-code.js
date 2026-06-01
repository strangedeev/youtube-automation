/**
 * exchange-code.js
 * Exchanges a Google OAuth authorization code for tokens and saves them
 * to config/tokens.json in the format the app expects ({ youtube: {...} }).
 *
 * Usage: node exchange-code.js "<the-code-from-the-url>"
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const code = process.argv[2];
if (!code) {
  console.error('❌ No code provided. Usage: node exchange-code.js "<code>"');
  process.exit(1);
}

const credPath = path.join(__dirname, 'config', 'credentials.json');
const tokenPath = path.join(__dirname, 'config', 'tokens.json');
const creds = JSON.parse(fs.readFileSync(credPath)).youtube;

const redirectUri = Array.isArray(creds.redirect_uris) ? creds.redirect_uris[0] : creds.redirect_uris;

const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);

(async () => {
  try {
    const { tokens } = await oauth2.getToken(code);

    // Preserve any existing non-youtube keys in tokens.json
    let existing = {};
    if (fs.existsSync(tokenPath)) {
      try { existing = JSON.parse(fs.readFileSync(tokenPath)); } catch (_) {}
    }
    existing.youtube = tokens;
    fs.writeFileSync(tokenPath, JSON.stringify(existing, null, 2));

    console.log('✅ Token saved to config/tokens.json');
    console.log('   has refresh_token:', !!tokens.refresh_token);
    console.log('   scopes:', tokens.scope);
    if (tokens.expiry_date) {
      console.log('   access token expires:', new Date(tokens.expiry_date).toLocaleString());
    }
  } catch (err) {
    console.error('❌ Exchange failed:', err.response?.data?.error_description || err.message);
    console.error('   (Auth codes expire in ~1 minute and are single-use — you may need a fresh one.)');
    process.exit(1);
  }
})();
