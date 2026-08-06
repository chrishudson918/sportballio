const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
from_uuid = require('uuid');
const { v4: uuidv4 } = from_uuid;

const app = express();
const PORT = process.env.PORT || 2323;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory database storing user configs mapped by UUID
// In production, sync to a sqlite/db file or encrypted volume.
const userConfigs = {};

// 1. Validate Xtream Credentials & Fetch Categories
app.post('/api/xtream/categories', async (req, res) => {
  const { url, username, password } = req.body;
  if (!url || !username || !password) {
    return res.status(400).json({ error: 'URL, username, and password are required.' });
  }

  const baseUrl = url.replace(/\/+$/, '');
  const apiUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;

  try {
    const response = await axios.get(apiUrl, { timeout: 10000 });
    if (Array.isArray(response.data)) {
      return res.json({ success: true, categories: response.data });
    } else if (response.data && response.data.user_info && response.data.user_info.auth === 0) {
      return res.status(401).json({ error: 'Invalid Xtream credentials.' });
    } else {
      return res.status(400).json({ error: 'Failed to fetch categories from Xtream server.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Unable to connect to Xtream server: ' + err.message });
  }
});

// 2. Save New User Configuration
app.post('/api/user/register', async (req, res) => {
  const { xtream, selectedSports, sportCategories, password } = req.body;
  if (!xtream || !selectedSports || !sportCategories || !password) {
    return res.status(400).json({ error: 'Missing required configuration fields.' });
  }

  const uuid = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);

  userConfigs[uuid] = {
    uuid,
    passwordHash,
    xtream, // { url, username, password }
    selectedSports, // ['NBA', 'NFL', ...]
    sportCategories // { NBA: [catId1, catId2], NFL: [...] }
  };

  return res.json({
    success: true,
    uuid,
    manifestUrl: `/user/${uuid}/manifest.json`
  });
});

// 3. Authenticate Existing User
app.post('/api/user/login', async (req, res) => {
  const { uuid, password } = req.body;
  const user = userConfigs[uuid];

  if (!user) {
    return res.status(404).json({ error: 'UUID not found.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  return res.json({
    success: true,
    uuid: user.uuid,
    xtream: user.xtream,
    selectedSports: user.selectedSports,
    sportCategories: user.sportCategories,
    manifestUrl: `/user/${uuid}/manifest.json`
  });
});

// 4. Update Existing User Configuration
app.post('/api/user/update', async (req, res) => {
  const { uuid, password, xtream, selectedSports, sportCategories } = req.body;
  const user = userConfigs[uuid];

  if (!user) {
    return res.status(404).json({ error: 'UUID not found.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  user.xtream = xtream;
  user.selectedSports = selectedSports;
  user.sportCategories = sportCategories;

  return res.json({
    success: true,
    uuid: user.uuid,
    manifestUrl: `/user/${uuid}/manifest.json`
  });
});

// 5. Dynamic Stremio / Nuvio Manifest Generator
app.get('/user/:uuid/manifest.json', (req, res) => {
  const { uuid } = req.params;
  const user = userConfigs[uuid];

  if (!user) {
    return res.status(404).json({ error: 'Manifest not found or invalid UUID.' });
  }

  const catalogs = user.selectedSports.map(sport => ({
    type: 'sports',
    id: `sportballio_${sport.toLowerCase()}`,
    name: `${sport} (Today's Games)`
  }));

  const manifest = {
    id: `org.sportballio.${uuid}`,
    version: '1.0.0',
    name: 'Sportballio Live Sports',
    description: 'Personalized IPTV Live Sports Add-on for Nuvio & Stremio',
    resources: ['catalog', 'meta', 'stream'],
    types: ['sports'],
    catalogs: catalogs
  };

  res.setHeader('Content-Type', 'application/json');
  res.json(manifest);
});

// 6. Dynamic Catalog Handler for Today's Games
app.get('/user/:uuid/catalog/sports/:id.json', async (req, res) => {
  const { uuid, id } = req.params;
  const user = userConfigs[uuid];

  if (!user) {
    return res.status(404).json({ metas: [] });
  }

  const sportName = id.replace('sportballio_', '').toUpperCase();
  const categoryIds = user.sportCategories[sportName] || [];

  // Placeholder metas demonstrating catalog payload with landscape & portrait graphics
  const metas = [
    {
      id: `sportballio:${sportName.toLowerCase()}_game_1`,
      type: 'sports',
      name: `${sportName}: Live Game 1`,
      poster: `https://dummyimage.com/600x900/0f172a/38bdf8.png&text=${sportName}+Live+Game+1`,
      background: `https://dummyimage.com/1920x1080/0f172a/38bdf8.png&text=${sportName}+Matchday+Coverage`,
      description: `Today's live streams for ${sportName} retrieved from configured Xtream categories.`
    }
  ];

  res.setHeader('Content-Type', 'application/json');
  res.json({ metas });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sportballio server active on http://0.0.0.0:${PORT}`);
});
