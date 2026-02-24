async function fetchNowPlaying() {
    try {
      const res = await fetch(SPOTIFY_API_URL);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      if (data.track) {
        const dot = data.isPlaying ? 'live' : 'offline';
        const label = data.isPlaying 
          ? '<span class="spotify-live-label">now</span> ' 
          : '';
        
        widget.innerHTML = `
          <div class="spotify-status">
            <span class="spotify-dot ${dot}"></span>
            ${label}<a href="${data.url}" class="spotify-link" target="_blank" rel="noopener">
              <span class="spotify-track">${data.track}</span>
              <span class="spotify-artist"> — ${data.artist}</span>
            </a>
          </div>
        `;
      } else {
        widget.innerHTML = `
          <div class="spotify-status">
            <span class="spotify-dot offline"></span>
            <span class="spotify-error">nothing playing</span>
          </div>
        `;
      }
    } catch (e) {
      // If the API isn't set up yet, show a graceful fallback
      widget.innerHTML = `
        <p style="font-weight: 300; font-size: 13px;">
          [Spotify integration pending setup — see source code for instructions]
        </p>
      `;
    }
  }
