const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 2323;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const userConfigs = {};

// Helper mapping Stremio sport names to ESPN API endpoints
const ESPN_ENDPOINTS = {
  NBA: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  NFL: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  MLB: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  NHL: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  WNBA: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard'
};

// 1. Fetch Today's Games from ESPN API
async function fetchTodayGames(sport) {
  const endpoint = ESPN_ENDPOINTS[sport.toUpperCase()];
  if (!endpoint) return [];

  try {
    const res = await axios.get(endpoint, { timeout: 5000 });
    const events = res.data?.events || [];

    return events.map(event => {
      const competition = event.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      
      const homeTeam = competitors.find(c => c.homeAway === 'home')?.team || {};
      const awayTeam = competitors.find(c => c.homeAway === 'away')?.team || {};

      return {
        id: event.id,
        name: event.name || `${awayTeam.displayName} vs ${homeTeam.displayName}`,
        shortName: event.shortName || `${awayTeam.abbreviation} @ ${homeTeam.abbreviation}`,
        homeTeam: homeTeam.displayName || 'Home',
        awayTeam: awayTeam.displayName || 'Away',
        poster: homeTeam.logo || awayTeam.logo || 'https://via.placeholder.com/300x450?text=Live+Sports',
        background: competition.venue?.fullName 
          ? `https://via.placeholder.com/1920x1080/0f172a/38bdf8.png&text=${encodeURIComponent(event.name)}`
          : 'https://via.placeholder.com/1920x1080/0f172a/38bdf8.png&text=Live+Sports',
        status: event.status?.type?.detail || 'Scheduled',
        date: event.date
      };
    });
  } catch (err) {
    console.error(`Error fetching ESPN scoreboard for ${sport}:`, err.message);
    return [];
  }
}

// 2. Fetch Xtream Streams for Configured Categories
async function fetchXtreamLiveStreams(user, categoryIds = []) {
  if (!categoryIds || categoryIds.length === 0) return [];
  const { url, username, password } = user.xtream;
  const baseUrl = url.replace(/\/+$/, '');

  let allStreams = [];
  for (const catId of categoryIds) {
    const apiUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams&category_id=${catId}`;
    try {
      const res = await axios.get(apiUrl, { timeout: 7000 });
      if (Array.isArray(res.data)) {
        allStreams = allStreams.concat(res.data);
      }
    } catch (e) {
      console.error(`Failed to fetch category ${catId} from Xtream:`, e.message);
    }
  }
  return allStreams;
}

// ---------------- REST API ROUTES ----------------

app.post('/api/xtream/categories', async (req, res) => {
  const { url, username, password } = req.body;
  if (!url || !username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const baseUrl = url.replace(/\/+$/, '');
  const apiUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;

  try {
    const response = await axios.get(apiUrl, { timeout: 10000 });
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
  return res.json({ success: true, uuid: user.uuid, manifestUrl: `/user/${uuid}/manifest.json` });
});

// ---------------- STREMIO / NUVIO ENGINE ----------------

app.get('/user/:uuid/manifest.json', (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.status(404).json({ error: 'Invalid manifest UUID' });

  const catalogs = user.selectedSports.map(sport => ({
    type: 'sports',
    id: `sportballio_${sport.toLowerCase()}`,
    name: `${sport} - Today's Games`
  }));

  res.setHeader('Content-Type', 'application/json');
  res.json({
    id: `org.sportballio.${user.uuid}`,
    version: '1.0.0',
    name: 'Sportballio',
    description: 'IPTV Live Sports directly mapped to ESPN game schedules',
    resources: ['catalog', 'meta', 'stream'],
    types: ['sports'],
    catalogs
  });
});

// Dynamic Catalog Endpoint (ESPN Real-Time Games)
app.get('/user/:uuid/catalog/sports/:id.json', async (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.json({ metas: [] });

  const sport = req.params.id.replace('sportballio_', '').toUpperCase();
  const games = await fetchTodayGames(sport);

  const metas = games.map(game => ({
    id: `sportballio:${sport.toLowerCase()}:${game.id}`,
    type: 'sports',
    name: game.name,
    poster: game.poster,
    background: game.background,
    description: `Status: ${game.status} | Scheduled: ${new Date(game.date).toLocaleTimeString()}`
  }));

  res.setHeader('Content-Type', 'application/json');
  res.json({ metas });
});

// Dynamic Meta Details Endpoint
app.get('/user/:uuid/meta/sports/:id.json', async (req, res) => {
  const [prefix, sport, gameId] = req.params.id.split(':');
  const games = await fetchTodayGames(sport);
  const game = games.find(g => g.id === gameId);

  if (!game) return res.json({ meta: {} });

  res.setHeader('Content-Type', 'application/json');
  res.json({
    meta: {
      id: req.params.id,
      type: 'sports',
      name: game.name,
      poster: game.poster,
      background: game.background,
      description: `Status: ${game.status} | Scheduled: ${new Date(game.date).toLocaleTimeString()}`
    }
  });
});

// Dynamic Stream Resolver Endpoint (Matches ESPN Game to Xtream Streams)
app.get('/user/:uuid/stream/sports/:id.json', async (req, res) => {
  const user = userConfigs[req.params.uuid];
  if (!user) return res.json({ streams: [] });

  const [prefix, sport, gameId] = req.params.id.split(':');
  const games = await fetchTodayGames(sport);
  const game = games.find(g => g.id === gameId);

  if (!game) return res.json({ streams: [] });

  const configuredCategoryIds = user.sportCategories[sport.toUpperCase()] || [];
  const xtreamStreams = await fetchXtreamLiveStreams(user, configuredCategoryIds);

  const homeKw = game.homeTeam.toLowerCase().split(' ');
  const awayKw = game.awayTeam.toLowerCase().split(' ');

  // Filter streams matching home or away team names
  const matchedStreams = xtreamStreams.filter(stream => {
    const streamName = stream.name.toLowerCase();
    const matchesHome = homeKw.some(kw => kw.length > 3 && streamName.includes(kw));
    const matchesAway = awayKw.some(kw => kw.length > 3 && streamName.includes(kw));
    return matchesHome || matchesAway;
  });

  const streamsToReturn = matchedStreams.length > 0 ? matchedStreams : xtreamStreams;
  const baseUrl = user.xtream.url.replace(/\/+$/, '');

  const streams = streamsToReturn.map(s => ({
    title: `${s.name} (${s.stream_type || 'Live'})`,
    url: `${baseUrl}/live/${encodeURIComponent(user.xtream.username)}/${encodeURIComponent(user.xtream.password)}/${s.stream_id}.m3u8`
  }));

  res.setHeader('Content-Type', 'application/json');
  res.json({ streams });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sportballio running at http://0.0.0.0:${PORT}`);
});
