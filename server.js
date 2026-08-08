const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 2323;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[Storage] Created data directory at ${DATA_DIR}`);
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Login rate limiting ---
// Tracks failed login attempts per IP address in memory.
// After LOGIN_MAX_ATTEMPTS failures within LOGIN_WINDOW_MS, that IP is locked out
// until the window passes. Resets automatically on server restart (intentional
// for a small single-instance deployment like this one).
const loginAttempts = new Map(); // ip -> { count, firstAttempt }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Periodically clear out stale entries so this Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now - record.firstAttempt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }
}, LOGIN_WINDOW_MS).unref();

let userConfigs = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    userConfigs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('[Storage] Error loading users.json:', err.message);
  }
}

function saveUserConfigs() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(userConfigs, null, 2), 'utf8');
  } catch (err) {
    console.error('[Storage] Failed to save users.json:', err.message);
  }
}

const ESPN_ENDPOINTS = {
  NBA: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  NFL: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  MLB: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  NHL: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  WNBA: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard'
};

const ESPN_LEAGUES = {
  NBA: 'nba',
  NFL: 'nfl',
  MLB: 'mlb',
  NHL: 'nhl',
  WNBA: 'wnba'
};

async function getBase64Image(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': 'https://www.espn.com/'
      },
      timeout: 5000
    });
    const contentType = response.headers['content-type'] || 'image/png';
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.error(`[ImageLoader] Failed to fetch image: ${url}. Error: ${err.message}`);
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgX6Y//4AAAAASUVOR5CYII=';
  }
}

function getLocalDateString(timeZone = 'America/New_York') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'America/New_York' });
    return formatter.format(new Date()).replace(/-/g, '');
  } catch (err) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}

function getLocalDateDash(timeZone = 'America/New_York') {
  const dateStr = getLocalDateString(timeZone);
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

function formatTimeForZone(utcDateStr, timeZone) {
  try {
    const date = new Date(utcDateStr);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return formatter.format(date).toLowerCase();
  } catch (err) {
    return 'TBD';
  }
}

function formatTeamTime(utcDateStr, timeZone) {
  try {
    const date = new Date(utcDateStr);
    const targetTz = timeZone || 'America/New_York';
    
    const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: targetTz, hour: 'numeric', minute: '2-digit', hour12: true });
    const tzFormatter = new Intl.DateTimeFormat('en-US', { timeZone: targetTz, timeZoneName: 'short' });

    const timeStr = timeFormatter.format(date).toLowerCase();
    const tzParts = tzFormatter.formatToParts(date);
    const tzName = tzParts.find(p => p.type === 'timeZoneName')?.value || '';

    return `${timeStr} ${tzName}`;
  } catch (err) {
    return null;
  }
}

app.get('/poster/:sport/:homeId/:awayId.svg', async (req, res) => {
  const { sport, homeId, awayId } = req.params;
  const gameUtcDate = req.query.date || null;
  const league = ESPN_LEAGUES[sport.toUpperCase()] || 'mlb';

  const homeLogoData = await getBase64Image(`https://a.espncdn.com/i/teamlogos/${league}/500/${homeId}.png`);
  const awayLogoData = await getBase64Image(`https://a.espncdn.com/i/teamlogos/${league}/500/${awayId}.png`);

  let pstTime = 'TBD';
  let mstTime = 'TBD';
  let estTime = 'TBD';

  if (gameUtcDate) {
    pstTime = formatTimeForZone(gameUtcDate, 'America/Los_Angeles');
    mstTime = formatTimeForZone(gameUtcDate, 'America/Phoenix');
    estTime = formatTimeForZone(gameUtcDate, 'America/New_York');
  }

  const timeBlock = gameUtcDate ? `
    <text x="300" y="700" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#f8fafc" text-anchor="middle" letter-spacing="1">
      ${pstTime} PT
    </text>
    <text x="300" y="758" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#cbd5e1" text-anchor="middle" letter-spacing="1">
      ${mstTime} MT
    </text>
    <text x="300" y="816" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#94a3b8" text-anchor="middle" letter-spacing="1">
      ${estTime} ET
    </text>
  ` : `
    <text x="300" y="758" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#94a3b8" text-anchor="middle" letter-spacing="1">
      GAME TIME TBD
    </text>
  `;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 900" width="600" height="900">
    <defs>
      <linearGradient id="posterGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="50%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#020617" />
      </linearGradient>
    </defs>
    <rect width="600" height="900" fill="url(#posterGrad)" />
    
    <!-- Home Team Logo (Top) -->
    <image href="${homeLogoData}" x="165" y="30" width="270" height="270" preserveAspectRatio="xMidYMid meet" />
    
    <!-- Away Team Logo (Middle) -->
    <image href="${awayLogoData}" x="165" y="330" width="270" height="270" preserveAspectRatio="xMidYMid meet" />

    <!-- Stacked Large Times (Bottom) -->
    <g>
      ${timeBlock}
    </g>
  </svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});

app.get('/landscape/:sport/:homeId/:awayId.svg', async (req, res) => {
  const { sport, homeId, awayId } = req.params;
  const league = ESPN_LEAGUES[sport.toUpperCase()] || 'mlb';

  const homeLogoData = await getBase64Image(`https://a.espncdn.com/i/teamlogos/${league}/500/${homeId}.png`);
  const awayLogoData = await getBase64Image(`https://a.espncdn.com/i/teamlogos/${league}/500/${awayId}.png`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1920 1080" width="1920" height="1080">
    <defs>
      <linearGradient id="landGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#020617" />
        <stop offset="50%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#0f172a" />
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#landGrad)" />
    <!-- Home Team Logo (Left) -->
    <image href="${homeLogoData}" x="220" y="215" width="650" height="650" preserveAspectRatio="xMidYMid meet" />
    <!-- Away Team Logo (Right) -->
    <image href="${awayLogoData}" x="1050" y="215" width="650" height="650" preserveAspectRatio="xMidYMid meet" />
  </svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

app.get('/landscape/:sport/:venueId/:homeId/:awayId.jpg', (req, res) => {
  const { sport, homeId, awayId } = req.params;
  res.redirect(`/landscape/${sport}/${homeId}/${awayId}.svg`);
});

async function fetchTodayGames(sport, hostUrl, userTimeZone = 'America/New_York') {
  const endpoint = ESPN_ENDPOINTS[sport.toUpperCase()];
  if (!endpoint) return [];

  try {
    const targetDateStr = getLocalDateString(userTimeZone);
    const res = await axios.get(`${endpoint}?dates=${targetDateStr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 7000
    });

    const events = res.data?.events || [];

    return events.map(event => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];

      const home = competitors.find(c => c.homeAway === 'home') || {};
      const away = competitors.find(c => c.homeAway === 'away') || {};

      const homeTeam = home.team || {};
      const awayTeam = away.team || {};

      const homeId = homeTeam.id || '0';
      const awayId = awayTeam.id || '0';

      const homeNick = homeTeam.name || homeTeam.shortDisplayName || homeTeam.displayName || 'Home';
      const awayNick = awayTeam.name || awayTeam.shortDisplayName || awayTeam.displayName || 'Away';
      
      const homeFull = homeTeam.displayName || 'Home';
      const awayFull = awayTeam.displayName || 'Away';

      const gameUtcDate = event.date || '';
      const dateParam = gameUtcDate ? `?date=${encodeURIComponent(gameUtcDate)}` : '';

      const poster = `${hostUrl}/poster/${sport.toLowerCase()}/${homeId}/${awayId}.svg${dateParam}`;
      const background = `${hostUrl}/landscape/${sport.toLowerCase()}/${homeId}/${awayId}.svg`;

      const homeWinLoss = home.records?.[0]?.summary || '0-0';
      const awayWinLoss = away.records?.[0]?.summary || '0-0';
      const statusDetail = event.status?.type?.detail || 'Scheduled';

      const venueName = competition.venue?.fullName || 'the arena';
      const venueCity = competition.venue?.address?.city || homeTeam.location || '';
      const venueState = competition.venue?.address?.state || '';
      const locationStr = venueState ? `${venueCity}, ${venueState}` : venueCity;

      let formattedTime = 'TBD';
      if (gameUtcDate) {
        formattedTime = formatTeamTime(gameUtcDate, userTimeZone) || 'TBD';
      }

      const description = `The ${homeNick} host the ${awayNick} in ${locationStr} at ${formattedTime}.\nLive from ${venueName}!\n\n${homeFull} (${homeWinLoss}) | ${awayFull} (${awayWinLoss})`;

      return {
        id: String(event.id),
        name: event.name || `${awayTeam.displayName || 'Away'} vs ${homeTeam.displayName || 'Home'}`,
        homeTeam: homeTeam.displayName || '',
        awayTeam: awayTeam.displayName || '',
        poster,
        background,
        description,
        status: statusDetail,
        date: event.date
      };
    });
  } catch (err) {
    console.error(`[ESPN] Error fetching scoreboard for ${sport}:`, err.message);
    return [];
  }
}

async function fetchXtreamLiveStreams(user, categoryIds = []) {
  if (!categoryIds || categoryIds.length === 0) return [];
  const { url, username, password } = user.xtream;
  const baseUrl = url.replace(/\/+$/, '');

  let allStreams = [];
  for (const catId of categoryIds) {
    const apiUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams&category_id=${catId}`;
    try {
      const res = await axios.get(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 8000
      });
      if (Array.isArray(res.data)) {
        allStreams = allStreams.concat(res.data);
      }
    } catch (e) {
      console.error(`[Xtream] Failed to fetch category ${catId}:`, e.message);
    }
  }
  return allStreams;
}

app.post('/api/xtream/categories', async (req, res) => {
  const { url, username, password } = req.body;
  if (!url || !username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const baseUrl = url.replace(/\/+$/, '');
  const apiUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;

  try {
    const response = await axios.get(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000
    });
    if (Array.isArray(response.data)) {
      return res.json({ success: true, categories: response.data });
    }
    return res.status(401).json({ error: 'Invalid Xtream credentials.' });
  } catch (err) {
    return res.status(500).json({ error: 'Unable to connect to IPTV server.' });
  }
});

app.post('/api/user/register', async (req, res) => {
  const { xtream, selectedSports, sportCategories, password, timeZone } = req.body;
  const uuid = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);

  userConfigs[uuid] = { 
    uuid, 
    passwordHash, 
    xtream, 
    selectedSports, 
    sportCategories,
    timeZone: timeZone || 'America/New_York'
  };
  saveUserConfigs();

  return res.json({ success: true, uuid, manifestUrl: `/user/${uuid}/manifest.json` });
});

app.post('/api/user/login', async (req, res) => {
  const { uuid, password } = req.body;
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record && now - record.firstAttempt < LOGIN_WINDOW_MS && record.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((LOGIN_WINDOW_MS - (now - record.firstAttempt)) / 1000);
    res.setHeader('Retry-After', retryAfterSec);
    return res.status(429).json({ error: `Too many login attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).` });
  }

  const user = userConfigs[uuid];
  const passwordOk = user && (await bcrypt.compare(password, user.passwordHash));

  if (!passwordOk) {
    if (record && now - record.firstAttempt < LOGIN_WINDOW_MS) {
      record.count++;
    } else {
      loginAttempts.set(ip, { count: 1, firstAttempt: now });
    }
    return res.status(401).json({ error: 'Invalid UUID or password.' });
  }

  loginAttempts.delete(ip);
  return res.json({ 
    success: true, 
    uuid: user.uuid, 
    xtream: user.xtream, 
    selectedSports: user.selectedSports, 
    sportCategories: user.sportCategories, 
    timeZone: user.timeZone || 'America/New_York',
    manifestUrl: `/user/${uuid}/manifest.json` 
  });
});

app.post('/api/user/update', async (req, res) => {
  const { uuid, password, xtream, selectedSports, sportCategories, timeZone } = req.body;
  const user = userConfigs[uuid];
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid UUID or password.' });
  }
  if (xtream !== undefined) user.xtream = xtream;
  if (selectedSports !== undefined) user.selectedSports = selectedSports;
  if (sportCategories !== undefined) user.sportCategories = sportCategories;
  if (timeZone) user.timeZone = timeZone;
  saveUserConfigs();

  return res.json({ success: true, uuid: user.uuid, manifestUrl: `/user/${uuid}/manifest.json` });
});

app.get('/user/:uuid/manifest.json', (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.status(404).json({ error: 'Invalid manifest UUID' });

  const targetDateStr = getLocalDateDash(user.timeZone);

  // A sport only appears as a catalog if at least one category folder
  // has been mapped to it — this keeps unconfigured sports out of Nuvio.
  const activeSports = Object.entries(user.sportCategories || {})
    .filter(([sport, categoryIds]) => Array.isArray(categoryIds) && categoryIds.length > 0)
    .map(([sport]) => sport);

  const catalogs = activeSports.map(sport => ({
    type: 'sports',
    id: `sb_${sport.toLowerCase()}_${targetDateStr}`,
    name: `${sport} Live Games`
  }));

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.json({
    id: `org.sportballio.${user.uuid}`,
    version: '2.2.8',
    name: 'Sportballio Live',
    description: 'Dynamic IPTV Sports directly mapped to ESPN game schedules',
    resources: ['catalog', 'meta', 'stream'],
    types: ['sports'],
    catalogs
  });
});

app.get('/user/:uuid/catalog/sports/:id.json', async (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.json({ metas: [] });

  const hostUrl = `${req.protocol}://${req.get('host')}`;
  const rawId = req.params.id.toLowerCase();
  let sport = 'MLB';

  if (rawId.includes('wnba')) sport = 'WNBA';
  else if (rawId.includes('nba')) sport = 'NBA';
  else if (rawId.includes('nfl')) sport = 'NFL';
  else if (rawId.includes('mlb')) sport = 'MLB';
  else if (rawId.includes('nhl')) sport = 'NHL';

  const userTz = user.timeZone || 'America/New_York';
  const games = await fetchTodayGames(sport, hostUrl, userTz);
  const configuredCategoryIds = user.sportCategories?.[sport] || [];
  const xtreamStreams = await fetchXtreamLiveStreams(user, configuredCategoryIds);

  let metas = [];

  if (games.length > 0) {
    metas = games.map(game => ({
      id: `sb:${sport.toLowerCase()}:${game.id}`,
      type: 'sports',
      name: game.name,
      poster: game.poster,
      background: game.background,
      description: game.description
    }));
  } else {
    metas = xtreamStreams.map(s => ({
      id: `sbstream:${sport.toLowerCase()}:${s.stream_id}`,
      type: 'sports',
      name: s.name,
      poster: s.stream_icon || 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=600&q=80',
      background: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1920&q=80',
      description: `Direct Channel ID: ${s.stream_id}`
    }));
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({ metas });
});

app.get('/user/:uuid/meta/sports/:id.json', async (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.json({ meta: {} });

  const hostUrl = `${req.protocol}://${req.get('host')}`;
  const [prefix, sport, idVal] = req.params.id.split(':');

  if (prefix === 'sb') {
    const userTz = user.timeZone || 'America/New_York';
    const games = await fetchTodayGames(sport.toUpperCase(), hostUrl, userTz);
    const game = games.find(g => g.id === idVal);
    if (!game) return res.json({ meta: {} });

    return res.json({
      meta: {
        id: req.params.id,
        type: 'sports',
        name: game.name,
        poster: game.poster,
        background: game.background,
        description: game.description
      }
    });
  } else {
    const configuredCategoryIds = user.sportCategories?.[sport.toUpperCase()] || [];
    const xtreamStreams = await fetchXtreamLiveStreams(user, configuredCategoryIds);
    const stream = xtreamStreams.find(s => String(s.stream_id) === String(idVal));

    return res.json({
      meta: {
        id: req.params.id,
        type: 'sports',
        name: stream ? stream.name : 'Live Stream',
        poster: stream?.stream_icon || 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=600&q=80',
        background: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1920&q=80',
        description: `Direct Channel ID: ${idVal}`
      }
    });
  }
});

app.get('/user/:uuid/stream/sports/:id.json', async (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.json({ streams: [] });

  const hostUrl = `${req.protocol}://${req.get('host')}`;
  const [prefix, sport, idVal] = req.params.id.split(':');
  const configuredCategoryIds = user.sportCategories?.[sport.toUpperCase()] || [];
  const xtreamStreams = await fetchXtreamLiveStreams(user, configuredCategoryIds);
  const baseUrl = user.xtream.url.replace(/\/+$/, '');

  if (prefix === 'sbstream') {
    const stream = xtreamStreams.find(s => String(s.stream_id) === String(idVal));
    if (!stream) return res.json({ streams: [] });

    return res.json({
      streams: [{
        title: stream.name,
        url: `${baseUrl}/live/${encodeURIComponent(user.xtream.username)}/${encodeURIComponent(user.xtream.password)}/${stream.stream_id}.m3u8`
      }]
    });
  }

  const userTz = user.timeZone || 'America/New_York';
  const games = await fetchTodayGames(sport.toUpperCase(), hostUrl, userTz);
  const game = games.find(g => g.id === idVal);

  if (!game) return res.json({ streams: [] });

  const homeKw = (game.homeTeam || '').toLowerCase().split(' ').filter(w => w.length > 2);
  const awayKw = (game.awayTeam || '').toLowerCase().split(' ').filter(w => w.length > 2);

  const matchedStreams = xtreamStreams.filter(s => {
    const streamName = s.name.toLowerCase();
    const matchesHome = homeKw.some(kw => streamName.includes(kw));
    const matchesAway = awayKw.some(kw => streamName.includes(kw));
    return matchesHome || matchesAway;
  });

  const streamsToReturn = matchedStreams.length > 0 ? matchedStreams : xtreamStreams;

  const streams = streamsToReturn.map(s => ({
    title: s.name,
    url: `${baseUrl}/live/${encodeURIComponent(user.xtream.username)}/${encodeURIComponent(user.xtream.password)}/${s.stream_id}.m3u8`
  }));

  res.setHeader('Content-Type', 'application/json');
  res.json({ streams });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sportballio running at http://0.0.0.0:${PORT}`);
});
