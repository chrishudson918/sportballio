const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 2323;
const DATA_FILE = path.join(__dirname, 'users.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Load user configs from disk on startup
let userConfigs = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    userConfigs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`[Storage] Loaded ${Object.keys(userConfigs).length} user configurations from users.json`);
  } catch (err) {
    console.error('[Storage] Error reading users.json:', err.message);
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

// Fetch live/today's games from ESPN API
async function fetchTodayGames(sport) {
  const endpoint = ESPN_ENDPOINTS[sport.toUpperCase()];
  if (!endpoint) return [];

  try {
    const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const res = await axios.get(`${endpoint}?dates=${todayStr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 6000
    });

    const events = res.data?.events || [];

    return events.map(event => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      
      const homeTeam = competitors.find(c => c.homeAway === 'home')?.team || {};
      const awayTeam = competitors.find(c => c.homeAway === 'away')?.team || {};

      return {
        id: String(event.id),
        name: event.name || `${awayTeam.displayName || 'Away'} vs ${homeTeam.displayName || 'Home'}`,
        homeTeam: homeTeam.displayName || '',
        awayTeam: awayTeam.displayName || '',
        poster: homeTeam.logo || awayTeam.logo || 'https://via.placeholder.com/300x450?text=Live+Sports',
        background: 'https://via.placeholder.com/1920x1080/0f172a/38bdf8.png?text=Live+Sports',
        status: event.status?.type?.detail || 'Scheduled',
        date: event.date
      };
    });
  } catch (err) {
    console.error(`[ESPN] Error fetching scoreboard for ${sport}:`, err.message);
    return [];
  }
}

// Fetch Xtream streams from configured categories
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
        timeout: 7000
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

// ---------------- API ENDPOINTS ----------------

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
  const { xtream, selectedSports, sportCategories, password } = req.body;
  const uuid = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);

  userConfigs[uuid] = { uuid, passwordHash, xtream, selectedSports, sportCategories };
  saveUserConfigs();

  return res.json({ success: true, uuid, manifestUrl: `/user/${uuid}/manifest.json` });
});

app.post('/api/user/login', async (req, res) => {
  const { uuid, password } = req.body;
  const user = userConfigs[uuid];
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid UUID or password.' });
  }
  return res.json({ success: true, uuid: user.uuid, xtream: user.xtream, selectedSports: user.selectedSports, sportCategories: user.sportCategories, manifestUrl: `/user/${uuid}/manifest.json` });
});

app.post('/api/user/update', async (req, res) => {
  const { uuid, password, xtream, selectedSports, sportCategories } = req.body;
  const user = userConfigs[uuid];
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid UUID or password.' });
  }
  user.xtream = xtream;
  user.selectedSports = selectedSports;
  user.sportCategories = sportCategories;
  saveUserConfigs();

  return res.json({ success: true, uuid: user.uuid, manifestUrl: `/user/${uuid}/manifest.json` });
});

// ---------------- STREMIO ENGINE ----------------

app.get('/user/:uuid/manifest.json', (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.status(404).json({ error: 'Invalid manifest UUID' });

  const todayStr = new Date().toISOString().split('T')[0];

  const catalogs = user.selectedSports.map(sport => ({
    type: 'sports',
    id: `sb_${sport.toLowerCase()}_${todayStr}`,
    name: `${sport} Live Games`
  }));

  res.setHeader('Content-Type', 'application/json');
  res.json({
    id: `org.sportballio.${user.uuid}`,
    version: '1.0.2',
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

  const parts = req.params.id.split('_');
  const sport = parts[1] ? parts[1].toUpperCase() : 'WNBA';

  const games = await fetchTodayGames(sport);
  const configuredCategoryIds = user.sportCategories[sport] || [];
  const xtreamStreams = await fetchXtreamLiveStreams(user, configuredCategoryIds);

  let metas = [];

  if (games.length > 0) {
    metas = games.map(game => ({
      id: `sb:${sport.toLowerCase()}:${game.id}`,
      type: 'sports',
      name: game.name,
      poster: game.poster,
      background: game.background,
      description: `Status: ${game.status}`
    }));
  } else {
    metas = xtreamStreams.map(s => ({
      id: `sbstream:${sport.toLowerCase()}:${s.stream_id}`,
      type: 'sports',
      name: s.name,
      poster: s.stream_icon || 'https://via.placeholder.com/300x450?text=IPTV+Stream',
      background: 'https://via.placeholder.com/1920x1080/0f172a/38bdf8.png?text=Live+Stream',
      description: `Direct Channel ID: ${s.stream_id}`
    }));
  }

  res.setHeader('Content-Type', 'application/json');
  res.json({ metas });
});

app.get('/user/:uuid/stream/sports/:id.json', async (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.json({ streams: [] });

  const [prefix, sport, idVal] = req.params.id.split(':');
  const configuredCategoryIds = user.sportCategories[sport.toUpperCase()] || [];
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

  const games = await fetchTodayGames(sport.toUpperCase());
  const game = games.find(g => g.id === idVal);
  if (!game) return res.json({ streams: [] });

  const homeKw = game.homeTeam.toLowerCase().split(' ').filter(w => w.length > 2);
  const awayKw = game.awayTeam.toLowerCase().split(' ').filter(w => w.length > 2);

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
