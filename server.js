const express = require('express');
const cors = require('cors');
const { addonBuilder } = require('stremio-addon-sdk');

const PORT = process.env.PORT || 2323;

const builder = new addonBuilder({
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
});

builder.defineCatalogHandler((args) => {
  return Promise.resolve({
    metas: [
      {
        id: 'sports:live1',
        type: 'sports',
        name: 'Live Sports Stream 1',
        poster: 'https://via.placeholder.com/300x450?text=Sportballio'
      }
    ]
  });
});

builder.defineStreamHandler((args) => {
  return Promise.resolve({
    streams: []
  });
});

const app = express();
app.use(cors());

const addonInterface = builder.getInterface();
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(addonInterface.manifest);
});

app.use('/', express.static('public'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sportballio Add-on running at http://0.0.0.0:${PORT}`);
  console.log(`Manifest URL: http://localhost:${PORT}/manifest.json`);
});
