// /api/practice-log.js
// Reads and writes practice data to a Google Sheet
// Sheet columns: timestamp | category | minutes | notes

const { google } = require('googleapis');

// These go in Vercel environment variables:
// GOOGLE_SERVICE_EMAIL - service account email
// GOOGLE_PRIVATE_KEY - service account private key
// GOOGLE_SHEET_ID - the spreadsheet ID from the URL

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;

  try {
    const sheets = await getSheets();

    // POST - log a practice session
    if (req.method === 'POST') {
      // Simple auth - check for a secret token
      const token = req.headers.authorization;
      if (token !== `Bearer ${process.env.PRACTICE_LOG_SECRET}`) {
        return res.status(401).json({ error: 'unauthorized' });
      }

      const { category, minutes, notes } = req.body;
      if (!category || !minutes) {
        return res.status(400).json({ error: 'category and minutes required' });
      }

      const timestamp = new Date().toISOString();

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Log!A:D',
        valueInputOption: 'RAW',
        requestBody: {
          values: [[timestamp, category, minutes, notes || '']]
        }
      });

      return res.status(200).json({ ok: true, timestamp, category, minutes });
    }

    // GET - read practice data
    if (req.method === 'GET') {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Log!A:D'
      });

      const rows = result.data.values || [];
      // Skip header row if present
      const entries = rows
        .filter(r => r[0] && !isNaN(Date.parse(r[0])))
        .map(r => ({
          timestamp: r[0],
          category: r[1],
          minutes: parseInt(r[2]) || 0,
          notes: r[3] || ''
        }));

      // Calculate summaries
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayOfWeek = now.getDay(); // 0=Sun
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfYear = new Date(now.getFullYear(), 0, 1);

      let weekTotal = 0, monthTotal = 0, yearTotal = 0, todayTotal = 0;
      let lastEntry = null;
      let lastDayMins = 0;
      let lastDayDate = null;
      const todayEntries = [];
      const weekByCategory = {};

      // Sort entries chronologically
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      entries.forEach(e => {
        const d = new Date(e.timestamp);
        if (d >= startOfYear) yearTotal += e.minutes;
        if (d >= startOfMonth) monthTotal += e.minutes;
        if (d >= startOfWeek) {
          weekTotal += e.minutes;
          if (!weekByCategory[e.category]) weekByCategory[e.category] = { minutes: 0, notes: '' };
          weekByCategory[e.category].minutes += e.minutes;
          if (e.notes) weekByCategory[e.category].notes = e.notes;
        }
        if (d >= startOfDay) {
          todayTotal += e.minutes;
          todayEntries.push(e);
        }

        // Track last practiced day
        const entryDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
        if (!lastDayDate || entryDay >= lastDayDate) {
          if (entryDay !== lastDayDate) {
            lastDayDate = entryDay;
            lastDayMins = 0;
          }
          lastDayMins += e.minutes;
          lastEntry = e;
        }
      });

      return res.status(200).json({
        weekTotal,
        monthTotal,
        yearTotal,
        todayTotal,
        todayEntries,
        weekByCategory,
        lastEntry: lastEntry ? {
          timestamp: lastEntry.timestamp,
          dayTotal: lastDayMins
        } : null,
        weekStart: startOfWeek.toISOString(),
        totalEntries: entries.length
      });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error('Practice log error:', err);
    return res.status(500).json({ error: 'server error', details: err.message });
  }
};
