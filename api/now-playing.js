module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  const nowRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
  });

  if (nowRes.status === 200) {
    const data = await nowRes.json();
    if (data.item) {
      return res.json({
        isPlaying: data.is_playing,
        track: data.item.name,
        artist: data.item.artists.map(function(a) { return a.name; }).join(', '),
        album: data.item.album.name,
        url: data.item.external_urls.spotify,
        playedAt: null,
      });
    }
  }

  const recentRes = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
  });

  if (recentRes.status === 200) {
    const data = await recentRes.json();
    if (data.items && data.items.length > 0) {
      var item = data.items[0];
      var track = item.track;
      return res.json({
        isPlaying: false,
        track: track.name,
        artist: track.artists.map(function(a) { return a.name; }).join(', '),
        album: track.album.name,
        url: track.external_urls.spotify,
        playedAt: item.played_at,
      });
    }
  }

  return res.json({ isPlaying: false, track: null, playedAt: null });
};
