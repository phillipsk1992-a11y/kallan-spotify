export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  const { access_token } = await tokenRes.json();

  const nowRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (nowRes.status === 200) {
    const data = await nowRes.json();
    if (data.item) {
      return res.json({
        isPlaying: data.is_playing,
        track: data.item.name,
        artist: data.item.artists.map(a => a.name).join(', '),
        album: data.item.album.name,
        url: data.item.external_urls.spotify,
      });
    }
  }

  const recentRes = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (recentRes.status === 200) {
    const data = await recentRes.json();
    if (data.items && data.items.length > 0) {
      const track = data.items[0].track;
      return res.json({
        isPlaying: false,
        track: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        album: track.album.name,
        url: track.external_urls.spotify,
      });
    }
  }

  return res.json({ isPlaying: false, track: null });
}