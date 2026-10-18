// api/spotify-auth.js
// One-time helper to get a fresh SPOTIFY_REFRESH_TOKEN.
// 1. Visit /api/spotify-auth  -> redirects to Spotify to approve
// 2. Spotify sends you back here with a code -> page shows the new refresh token
// Safe to delete once the new token is saved in Vercel.

const SCOPES = 'user-read-currently-playing user-read-recently-played user-read-playback-state';

function page(res, status, title, body) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<body style="font:16px/1.6 Georgia,serif;max-width:640px;margin:3rem auto;padding:0 1rem;color:#1c2a29;background:#dde6e2">' +
    '<h1 style="font-weight:400">' + title + '</h1>' + body + '</body>');
}

function esc(s) { return String(s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

module.exports = async function handler(req, res) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return page(res, 500, 'Missing settings', '<p>SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is not set in this Vercel project.</p>');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = 'https://' + host + '/api/spotify-auth';
  const url = new URL(req.url, 'https://' + host);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return page(res, 400, 'Spotify said no', '<p>Spotify returned: <code>' + esc(error) + '</code>.</p>' +
      '<p>If it mentions the redirect URI, add <code>' + esc(redirectUri) + '</code> to your app\'s Redirect URIs in the Spotify Developer Dashboard and try again.</p>');
  }

  if (!code) {
    const auth = new URL('https://accounts.spotify.com/authorize');
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('scope', SCOPES);
    auth.searchParams.set('redirect_uri', redirectUri);
    auth.searchParams.set('show_dialog', 'true');
    res.statusCode = 302;
    res.setHeader('Location', auth.toString());
    return res.end();
  }

  const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code, redirect_uri: redirectUri }),
  });
  const data = await tokenRes.json();

  if (!data.refresh_token) {
    return page(res, 400, 'Token exchange failed', '<p>Spotify returned:</p><pre style="white-space:pre-wrap">' + esc(JSON.stringify(data, null, 2)) + '</pre>' +
      '<p>If it says <code>invalid_client</code>, the client secret in Vercel doesn\'t match the one in the Spotify dashboard.</p>');
  }

  return page(res, 200, 'New refresh token',
    '<p>Copy this into Vercel as <code>SPOTIFY_REFRESH_TOKEN</code> (kallan-spotify project → Settings → Environment Variables), then redeploy.</p>' +
    '<textarea readonly onclick="this.select()" style="width:100%;height:9rem;font:14px monospace;padding:.6rem">' + esc(data.refresh_token) + '</textarea>' +
    '<p>Scopes granted: <code>' + esc(data.scope || '') + '</code></p>' +
    '<p>Don\'t share this token. Close this tab once it\'s saved.</p>');
};
