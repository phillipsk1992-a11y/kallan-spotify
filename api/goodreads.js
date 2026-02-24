module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Try currently-reading shelf first
    var userId = '13258755';
    var currentUrl = 'https://www.goodreads.com/review/list_rss/' + userId + '?shelf=currently-reading';
    var response = await fetch(currentUrl);
    var text = await response.text();

    var itemMatch = text.match(/<item>([\s\S]*?)<\/item>/);

    if (itemMatch) {
      var item = itemMatch[1];
      var parsed = parseItem(item);
      parsed.status = 'reading';
      return res.json(parsed);
    }

    // Fallback to most recently read book
    var readUrl = 'https://www.goodreads.com/review/list_rss/' + userId + '?shelf=read';
    var readResponse = await fetch(readUrl);
    var readText = await readResponse.text();

    var readMatch = readText.match(/<item>([\s\S]*?)<\/item>/);

    if (readMatch) {
      var readItem = readMatch[1];
      var readParsed = parseItem(readItem);
      readParsed.status = 'finished';
      return res.json(readParsed);
    }

    return res.json({ book: null });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch reading data' });
  }
};

function parseItem(item) {
  var titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
  var authorMatch = item.match(/<author_name>([\s\S]*?)<\/author_name>/);
  var linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
  var ratingMatch = item.match(/<user_rating>(\d+)<\/user_rating>/);
  var readAtMatch = item.match(/<user_read_at><!\[CDATA\[([\s\S]*?)\]\]><\/user_read_at>/);

  var title = titleMatch ? titleMatch[1].trim() : null;
  var author = authorMatch ? authorMatch[1].trim() : null;
  var link = linkMatch ? linkMatch[1].trim() : null;
  var rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;
  var readAt = readAtMatch ? readAtMatch[1].trim() : null;

  var stars = null;
  if (rating > 0) {
    stars = '';
    for (var i = 0; i < rating; i++) {
      stars += '\u2605';
    }
  }

  return {
    book: title,
    author: author,
    url: link,
    rating: stars,
    readAt: readAt,
  };
}
