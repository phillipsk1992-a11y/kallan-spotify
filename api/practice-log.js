// api/practice-log.js
// Serverless function for Woodshed practice logger
// Connects to Google Sheets via Google Sheets API

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Log';
const API_SECRET = process.env.PRACTICE_LOG_SECRET;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    const missing = [];
    if (!email) missing.push('GOOGLE_SERVICE_EMAIL');
    if (!key) missing.push('GOOGLE_PRIVATE_KEY');
    throw new Error('Missing env vars: ' + missing.join(', ') + '. Available: ' + Object.keys(process.env).filter(k => k.includes('GOOGLE')).join(', '));
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, '\n'),
    },
    scopes: SCOPES,
  });
  return auth;
}

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// Parse a timestamp string into a Date object (handles both ISO and sheet formats)
function parseTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

// Convert a UTC date to "local" time given a timezone offset (from getTimezoneOffset())
// getTimezoneOffset() returns minutes: UTC+12 → -720
function toLocal(utcDate, tzOffset) {
  return new Date(utcDate.getTime() - tzOffset * 60000);
}

// Get start of day in user's local timezone, returned as UTC timestamp
function getDayStart(date, tzOffset) {
  const local = toLocal(date, tzOffset);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + tzOffset * 60000);
}

// Get the Monday of the current week in user's local timezone, returned as UTC
function getWeekStart(date, tzOffset) {
  const local = toLocal(date, tzOffset);
  const day = local.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = local.getUTCDate() - day + (day === 0 ? -6 : 1);
  local.setUTCDate(diff);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + tzOffset * 60000);
}

// Get start of month in user's local timezone, returned as UTC
function getMonthStart(date, tzOffset) {
  const local = toLocal(date, tzOffset);
  local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + tzOffset * 60000);
}

// Get local date string (YYYY-MM-DD) for a UTC timestamp
function getLocalDateStr(utcDate, tzOffset) {
  const local = toLocal(utcDate, tzOffset);
  return local.toISOString().split('T')[0];
}

// Calculate streak (consecutive days with at least one entry)
function calculateStreak(rows, tzOffset) {
  if (!rows || rows.length === 0) return 0;

  // Collect unique practice dates in local timezone (YYYY-MM-DD)
  const dates = new Set();
  rows.forEach(row => {
    const ts = parseTimestamp(row[0]);
    if (ts) {
      dates.add(getLocalDateStr(ts, tzOffset));
    }
  });

  const sortedDates = Array.from(dates).sort().reverse();
  if (sortedDates.length === 0) return 0;

  // Check if the most recent date is today or yesterday (in local time)
  const now = new Date();
  const todayStr = getLocalDateStr(now, tzOffset);
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayStr = getLocalDateStr(yesterday, tzOffset);

  if (sortedDates[0] !== todayStr && sortedDates[0] !== yesterdayStr) return 0;

  let streak = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const curr = new Date(sortedDates[i - 1]);
    const prev = new Date(sortedDates[i]);
    const diffDays = Math.round((curr - prev) / 86400000);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

// Get intensity level based on minutes
function getIntensity(minutes) {
  if (minutes === 0) return 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Auth check (POST only, matches existing pattern)
  if (req.method === 'POST') {
    const token = req.headers.authorization;
    if (token !== `Bearer ${API_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const sheets = await getSheets();

  // ─── POST: Log an entry ───
  if (req.method === 'POST') {
    try {
      const { category, minutes, notes, type, venue } = req.body;

      if (!category || !minutes) {
        return res.status(400).json({ error: 'category and minutes are required' });
      }

      const entryType = type || 'practice';
      const entryVenue = venue || '';
      const timestamp = new Date().toISOString();

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:F`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[timestamp, category, minutes, notes || '', entryType, entryVenue]],
        },
      });

      return res.status(200).json({ success: true, timestamp });
    } catch (err) {
      console.error('POST error:', err);
      return res.status(500).json({ error: 'Failed to log entry' });
    }
  }

  // ─── GET: Return stats ───
  if (req.method === 'GET') {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:F`,
      });

      const rows = result.data.values || [];
      // Skip header row if present
      const data = rows.length > 0 && rows[0][0] && rows[0][0].toLowerCase() === 'timestamp'
        ? rows.slice(1)
        : rows;

      const now = new Date();
      const tzOffset = parseInt(req.query.tz) || 0; // from getTimezoneOffset()
      const todayStart = getDayStart(now, tzOffset);
      const weekStart = getWeekStart(now, tzOffset);
      const monthStart = getMonthStart(now, tzOffset);

      // Parse all entries
      const entries = data.map(row => ({
        timestamp: parseTimestamp(row[0]),
        category: (row[1] || '').toLowerCase(),
        minutes: parseInt(row[2]) || 0,
        notes: row[3] || '',
        type: (row[4] || 'practice').toLowerCase(),
        venue: row[5] || '',
      })).filter(e => e.timestamp);

      // Sort by timestamp descending
      entries.sort((a, b) => b.timestamp - a.timestamp);

      // Today's entries
      const todayEntries = entries.filter(e => e.timestamp >= todayStart);

      // This week entries
      const weekEntries = entries.filter(e => e.timestamp >= weekStart);

      // This month entries
      const monthEntries = entries.filter(e => e.timestamp >= monthStart);

      // Category breakdown (all time)
      const categoryBreakdown = {};
      entries.forEach(e => {
        if (e.type === 'practice') {
          categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + e.minutes;
        }
      });

      // Category breakdown this month
      const categoryBreakdownMonth = {};
      monthEntries.forEach(e => {
        if (e.type === 'practice') {
          categoryBreakdownMonth[e.category] = (categoryBreakdownMonth[e.category] || 0) + e.minutes;
        }
      });

      // Streak
      const streak = calculateStreak(data, tzOffset);

      // Last practice entry
      const lastPractice = entries.find(e => e.type === 'practice');
      // Last gig
      const lastGig = entries.find(e => e.type === 'gig');

      // Recent gigs (last 10)
      const recentGigs = entries.filter(e => e.type === 'gig').slice(0, 10);

      // This week totals
      const weekPracticeMinutes = weekEntries
        .filter(e => e.type === 'practice')
        .reduce((sum, e) => sum + e.minutes, 0);
      const weekGigMinutes = weekEntries
        .filter(e => e.type === 'gig')
        .reduce((sum, e) => sum + e.minutes, 0);
      const weekTotalMinutes = weekPracticeMinutes + weekGigMinutes;
      const weekSessionCount = weekEntries.filter(e => e.type === 'practice').length;
      const weekGigCount = weekEntries.filter(e => e.type === 'gig').length;

      // This month totals
      const monthTotalMinutes = monthEntries.reduce((sum, e) => sum + e.minutes, 0);
      const monthGigCount = monthEntries.filter(e => e.type === 'gig').length;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const currentMonth = monthNames[toLocal(now, tzOffset).getUTCMonth()];

      // This year totals
      const localNowForYear = toLocal(now, tzOffset);
      const yearStartLocal = new Date(Date.UTC(localNowForYear.getUTCFullYear(), 0, 1));
      const yearStartUTC = new Date(yearStartLocal.getTime() + tzOffset * 60000);
      const yearEntries = entries.filter(e => e.timestamp >= yearStartUTC);
      const yearTotalMinutes = yearEntries.reduce((sum, e) => sum + e.minutes, 0);

      // Week daily breakdown (Mon=0 through Sun=6)
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const dayStart = new Date(weekStart.getTime() + i * 86400000);
        const dayEnd = new Date(dayStart.getTime() + 86400000);

        const dayEntries = entries.filter(e =>
          e.timestamp >= dayStart && e.timestamp < dayEnd
        );
        const dayMinutes = dayEntries.reduce((sum, e) => sum + e.minutes, 0);
        const hasGig = dayEntries.some(e => e.type === 'gig');
        const isFuture = dayStart > now;
        const todayLocalStr = getLocalDateStr(now, tzOffset);
        const dayLocalStr = getLocalDateStr(dayStart, tzOffset);
        const isToday = dayLocalStr === todayLocalStr;

        weekDays.push({
          date: dayLocalStr,
          dayLabel: ['m', 't', 'w', 't', 'f', 's', 's'][i],
          minutes: dayMinutes,
          intensity: getIntensity(dayMinutes),
          hasGig,
          isFuture,
          isToday,
        });
      }

      // Contribution grid data (full year, 52 weeks × 7 days)
      const localNow = toLocal(now, tzOffset);
      const yearNum = localNow.getUTCFullYear();
      // Find first Monday on or before Jan 1 of this year (in local time)
      const jan1Local = new Date(Date.UTC(yearNum, 0, 1));
      const jan1Day = jan1Local.getUTCDay();
      const firstMondayLocal = new Date(jan1Local);
      firstMondayLocal.setUTCDate(firstMondayLocal.getUTCDate() - (jan1Day === 0 ? 6 : jan1Day - 1));
      // Convert back to UTC for comparison
      const gridStart = new Date(firstMondayLocal.getTime() + tzOffset * 60000);

      const gridData = [];
      for (let i = 0; i < 52 * 7; i++) {
        const cellStart = new Date(gridStart.getTime() + i * 86400000);
        const cellEnd = new Date(cellStart.getTime() + 86400000);

        const cellEntries = entries.filter(e =>
          e.timestamp >= cellStart && e.timestamp < cellEnd
        );
        const cellMinutes = cellEntries.reduce((sum, e) => sum + e.minutes, 0);
        const hasGig = cellEntries.some(e => e.type === 'gig');
        const isFuture = cellStart > now;

        gridData.push({
          date: getLocalDateStr(cellStart, tzOffset),
          minutes: cellMinutes,
          intensity: isFuture ? -1 : getIntensity(cellMinutes),
          hasGig: hasGig && !isFuture,
        });
      }

      // Weekly average (last 4 complete weeks)
      let weekAvgMinutes = 0;
      const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 86400000);
      const last4WeekEntries = entries.filter(e =>
        e.timestamp >= fourWeeksAgo && e.timestamp < weekStart
      );
      const last4WeekTotal = last4WeekEntries.reduce((sum, e) => sum + e.minutes, 0);
      weekAvgMinutes = Math.round(last4WeekTotal / 4);

      // Top category this week
      const weekCategoryTotals = {};
      weekEntries.filter(e => e.type === 'practice').forEach(e => {
        weekCategoryTotals[e.category] = (weekCategoryTotals[e.category] || 0) + e.minutes;
      });
      const topWeekCategory = Object.entries(weekCategoryTotals)
        .sort((a, b) => b[1] - a[1])[0];

      // Total gig count
      const totalGigCount = entries.filter(e => e.type === 'gig').length;

      return res.status(200).json({
        today: {
          entries: todayEntries.map(e => ({
            category: e.category,
            minutes: e.minutes,
            notes: e.notes,
            type: e.type,
            venue: e.venue,
            timestamp: e.timestamp.toISOString(),
          })),
          totalMinutes: todayEntries.reduce((sum, e) => sum + e.minutes, 0),
        },
        week: {
          days: weekDays,
          totalMinutes: weekTotalMinutes,
          practiceMinutes: weekPracticeMinutes,
          sessionCount: weekSessionCount,
          gigCount: weekGigCount,
          topCategory: topWeekCategory ? topWeekCategory[0] : null,
          topCategoryMinutes: topWeekCategory ? topWeekCategory[1] : 0,
        },
        month: {
          totalMinutes: monthTotalMinutes,
          gigCount: monthGigCount,
          name: currentMonth,
        },
        year: {
          totalMinutes: yearTotalMinutes,
        },
        streak,
        weekAvgHours: parseFloat((weekAvgMinutes / 60).toFixed(1)),
        totalGigCount,
        lastPractice: lastPractice ? {
          timestamp: lastPractice.timestamp.toISOString(),
          category: lastPractice.category,
          minutes: lastPractice.minutes,
        } : null,
        lastGig: lastGig ? {
          timestamp: lastGig.timestamp.toISOString(),
          venue: lastGig.venue,
          minutes: lastGig.minutes,
        } : null,
        recentGigs: recentGigs.map(g => ({
          timestamp: g.timestamp.toISOString(),
          venue: g.venue,
          minutes: g.minutes,
          notes: g.notes,
        })),
        categoryBreakdown,
        categoryBreakdownMonth,
        categoryBreakdownWeek: weekCategoryTotals,
        grid: gridData,
      });
    } catch (err) {
      console.error('GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
