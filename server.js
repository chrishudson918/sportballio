const express = require('express');
const cors = require('cors');
const { addonBuilder } = require('stremio-addon-sdk');

const PORT = process.env.PORT || 2323;

function getManifest(configParams = {}) {
  return {
    id: 'org.sportballio.addon',
    version: '1.0.0',
    name: 'Sportballio',
    description: 'Live Sports IPTV streams and schedules for Stremio / Nuvio',
    resources: ['catalog', 'stream'],
    types: ['tv', 'sports'],
    idPrefixes: ['sports:'],
    catalogs: [
      {
        type: 'sports',
        id: 'sportballio_catalog',
        name: 'Sportballio Live Sports'
      }
    ]
  };
}

const app = express();
app.use(cors());

// Serve standard manifest
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(getManifest());
});

// Serve customized manifest with user choices embedded
app.get('/config=:config/manifest.json', (req, res) => {
  const config = req.params.config;
  res.setHeader('Content-Type', 'application/json');
  res.send(getManifest(config));
});

app.use('/', express.static('public'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sportballio Add-on running at http://0.0.0.0:${PORT}`);
});
