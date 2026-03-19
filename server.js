const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = 'ebf828cee0c247d741862dc0618f3c3a2febe32b4e4822d6fdd7340edbe1';
const API_HOST = 'api.business.karafun.com';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function karafunRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: API_HOST,
      path: apiPath,
      method: method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Liste des appareils
app.get('/api/devices', async (req, res) => {
  try {
    const result = await karafunRequest('GET', '/device/list', null);
    res.status(result.status).json(JSON.parse(result.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sessions existantes (pour calculer les créneaux libres)
app.get('/api/sessions', async (req, res) => {
  try {
    const qs = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
    const result = await karafunRequest('GET', '/session/' + qs, null);
    res.status(result.status).json(JSON.parse(result.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Créer une session
app.post('/api/session', async (req, res) => {
  try {
    const result = await karafunRequest('POST', '/session/', req.body);
    res.status(result.status).json(JSON.parse(result.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toutes les autres routes → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ La Loge - Serveur démarré sur le port ${PORT}`));
