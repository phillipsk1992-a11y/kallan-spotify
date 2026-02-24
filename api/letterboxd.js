module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    var rssUrl = 'https://letterboxd.com/kallp/rss/';
    var response = await fetch(rssUrl);

    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to fetch RSS feed' });
    }

    var text = await response.text();

    // Parse the most recent item from the RSS feed
    var itemMatch = text.match(/<item>([\s\S]*?)<\/item>/);
    if (!itemMatch) {
      return res.json({ film: null });
    }

    var item = itemMatch[1];

    // Extract title (format is usually "Film Title, Year")
    var titleMatch = item.match(/<letterboxd:filmTitle>([\s\S]*?)<\/letterboxd:filmTitle>/);
    var yearMatch = item.match(/<letterboxd:filmYear>([\s\S]*?)<\/letterboxd:filmYear>/);
    var ratingMatch = item.match(/<letterboxd:memberRating>([\s\S]*?)<\/letterboxd:memberRating>/);
    var linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
    var watchedMatch = item.match(/<letterboxd:watchedDate>([\s\S]*?)<\/letterboxd:watchedDate>/);
    var rewatchMatch = item.match(/<letterboxd:rewatch>([\s\S]*?)<\/letterboxd:rewatch>/);

    var filmTitle = titleMatch ? titleMatch[1].trim() : null;
    var filmYear = yearMatch ? yearMatch[1].trim() : null;
    var rating = ratingMatch ? parseFloat(ratingMatch[1].trim()) : null;
    var link = linkMatch ? linkMatch[1].trim() : null;
    var watchedDate = watchedMatch ? watchedMatch[1].trim() : null;
    var isRewatch = rewatchMatch ? rewatchMatch[1].trim() === 'Yes' : false;

    // Convert rating number to stars
    var stars = null;
    if (rating !== null) {
      var fullStars = Math.floor(rating);
      var halfStar = rating % 1 >= 0.5;
      stars = '';
      for (var i = 0; i < fullStars; i++) {
        stars += '\u2605';
      }
      if (halfStar) {
        stars += '\u00BD';
      }
    }

    return res.json({
      film: filmTitle,
      year: filmYear,
      rating: stars,
      url: link,
      watchedDate: watchedDate,
      isRewatch: isRewatch,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to parse feed' });
  }
};
