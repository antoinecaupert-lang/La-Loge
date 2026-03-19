const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const KARAFUN_TOKEN = 'ebf828cee0c247d741862dc0618f3c3a2febe32b4e4822d6fdd7340edbe1';
const API_HOST = 'api.business.karafun.com';

// Twilio
const TWILIO_SID = process.env.TWILIO_SID || 'AC0dd29fe32ac57b2e6bf73dedd417cbc0';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || 'b1fd490486e61a770bf3b1c3d126dad5';
const TWILIO_FROM = process.env.TWILIO_FROM || '+18777804236';

// Timers SMS en mémoire
const smsTimers = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- KARAFUN ----
function karafunRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: API_HOST,
      path: apiPath,
      method: method,
      headers: {
        'Authorization': `Bearer ${KARAFUN_TOKEN}`,
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

// ---- TWILIO SMS ----
function sendSms(to, message) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: message }).toString();
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const options = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { console.log(`SMS ${res.statusCode}`); resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---- VERIFIER DISPO ET ENVOYER SMS ----
async function checkAndSendExtensionSms(session) {
  try {
    const endTime = new Date(session.end_at_timestamp || session.end_at);
    const nextEnd = new Date(endTime.getTime() + 60 * 60 * 1000);
    const startStr = encodeURIComponent(endTime.toISOString().slice(0,19) + '+00:00');
    const endStr = encodeURIComponent(nextEnd.toISOString().slice(0,19) + '+00:00');
    const result = await karafunRequest('GET', `/session/?start_at_timestamp=${startStr}&end_at_timestamp=${endStr}`, null);
    const sessions = JSON.parse(result.body);

    const conflict = sessions.some(s => {
      if (s.id === session.id || s.device_id !== session.device_id) return false;
      const sStart = new Date(s.start_at_timestamp || s.start_at);
      const sEnd = new Date(s.end_at_timestamp || s.end_at);
      return endTime < sEnd && nextEnd > sStart;
    });

    if (conflict) { console.log(`Loge occupée après session ${session.id} — pas de SMS`); return; }

    const siteUrl = process.env.SITE_URL || 'https://votre-site.vercel.app';
    const msg = `🎤 La Loge — Bonjour ${session.customer_firstname} ! Votre session se termine dans 15 min. Votre loge est libre pour une heure de plus. Prolongez ici : ${siteUrl}`;
    await sendSms(session.phone, msg);
    console.log(`SMS prolongation envoyé à ${session.phone}`);
  } catch(e) {
    console.error('Erreur SMS:', e.message);
  }
}

// ---- PROGRAMMER LE SMS ----
function scheduleSms(session) {
  if (!session.phone || !session.id) return;
  const endTime = new Date(session.end_at_timestamp || session.end_at);
  const smsTime = new Date(endTime.getTime() - 15 * 60 * 1000);
  const delay = smsTime.getTime() - Date.now();
  if (delay <= 0) { console.log(`Session ${session.id} trop courte pour SMS`); return; }
  if (smsTimers[session.id]) clearTimeout(smsTimers[session.id]);
  smsTimers[session.id] = setTimeout(() => {
    checkAndSendExtensionSms(session);
    delete smsTimers[session.id];
  }, delay);
  console.log(`SMS programmé session ${session.id} dans ${Math.round(delay/60000)} min`);
}

// ---- ROUTES ----
app.get('/api/devices', async (req, res) => {
  try {
    const result = await karafunRequest('GET', '/device/list', null);
    res.status(result.status).json(JSON.parse(result.body));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const qs = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
    const result = await karafunRequest('GET', '/session/' + qs, null);
    res.status(result.status).json(JSON.parse(result.body));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/session', async (req, res) => {
  try {
    const { phone, ...karafunBody } = req.body;
    const result = await karafunRequest('POST', '/session/', karafunBody);
    const session = JSON.parse(result.body);
    if (session.id && phone) scheduleSms({ ...session, phone });
    res.status(result.status).json(session);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ La Loge démarrée sur le port ${PORT}`));
