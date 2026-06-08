require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const Stripe = require('stripe');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const Astronomy = require('astronomy-engine');
const { find: geoTzFind } = require('geo-tz');

let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  }
} catch(e) {
  console.error('Stripe init error:', e.message);
}
const JWT_SECRET = process.env.JWT_SECRET || 'inner-compass-secret-2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'melissa2024compass';
const ADMIN_SECRET = 'admin-' + JWT_SECRET;

// Simple file-based user store
const USERS_FILE = path.join(__dirname, 'users.json');
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const app = express();
app.use(express.json());
app.use(cookieParser());

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    const users = loadUsers();
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users[decoded.email];
    if (!user || user.status !== 'active') return res.redirect('/login');
    req.user = user;
    next();
  } catch {
    res.redirect('/login');
  }
}

// Serve landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Serve subscribe page
app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subscribe.html'));
});

// Webinar registration page (public)
app.get('/webinar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'webinar.html'));
});

// Webinar registration API
app.post('/api/webinar-register', async (req, res) => {
  const { firstName, email } = req.body;
  if (!firstName || !email) return res.status(400).json({ error: 'Missing fields' });

  try {
    await addToMailerLite(firstName, email);
    res.json({ ok: true });
  } catch (e) {
    console.error('Webinar register error:', e.message);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve the app (protected)
app.get('/app', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Welcome page after signup
app.get('/welcome', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'welcome.html'));
});

// Protect all member content — anything not in the public allowlist requires a valid session
const PUBLIC_ROUTES = new Set(['/', '/login', '/subscribe', '/webinar', '/admin', '/becoming-whole']);
const PUBLIC_API_PREFIXES = ['/api/login', '/api/register', '/api/webinar-register', '/api/subscribe', '/api/webhook', '/api/activate', '/api/admin'];

function protectMemberContent(req, res, next) {
  if (PUBLIC_ROUTES.has(req.path)) return next();
  if (PUBLIC_API_PREFIXES.some(p => req.path.startsWith(p))) return next();
  // Allow static assets (images, audio, fonts, manifests — not HTML pages)
  if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|mp3|m4a|wav|woff|woff2|ttf|json|webmanifest)$/i.test(req.path)) return next();
  requireAuth(req, res, next);
}

app.use(protectMemberContent);
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const _corePrompt = fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf8');
const _contentPath = path.join(__dirname, 'content-library.md');
const _contentLibrary = fs.existsSync(_contentPath) ? fs.readFileSync(_contentPath, 'utf8') : '';
const SYSTEM_PROMPT = _contentLibrary.trim()
  ? _corePrompt + "\n\n---\n\n## MELISSA'S PUBLISHED CONTENT & TEACHINGS\n\nThe following are Melissa's own words. Draw on these naturally in conversation.\n\n" + _contentLibrary
  : _corePrompt;


// ─── ASTROLOGY CHART CALCULATIONS ───────────────────────────────────────────

function longitudeToSign(lon) {
  const signs = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  return signs[Math.floor((((lon % 360) + 360) % 360) / 30)];
}

function getSunSign(month, day) {
  if ((month===3&&day>=21)||(month===4&&day<=19)) return 'aries';
  if ((month===4&&day>=20)||(month===5&&day<=20)) return 'taurus';
  if ((month===5&&day>=21)||(month===6&&day<=20)) return 'gemini';
  if ((month===6&&day>=21)||(month===7&&day<=22)) return 'cancer';
  if ((month===7&&day>=23)||(month===8&&day<=22)) return 'leo';
  if ((month===8&&day>=23)||(month===9&&day<=22)) return 'virgo';
  if ((month===9&&day>=23)||(month===10&&day<=22)) return 'libra';
  if ((month===10&&day>=23)||(month===11&&day<=21)) return 'scorpio';
  if ((month===11&&day>=22)||(month===12&&day<=21)) return 'sagittarius';
  if ((month===12&&day>=22)||(month===1&&day<=19)) return 'capricorn';
  if ((month===1&&day>=20)||(month===2&&day<=18)) return 'aquarius';
  return 'pisces';
}

function getMoonSign(astroTime) {
  const moonEq = Astronomy.GeoMoon(astroTime);
  const ecliptic = Astronomy.Ecliptic(moonEq);
  return longitudeToSign(ecliptic.elon);
}

function getAscendant(astroTime, lat, lng) {
  const gst = Astronomy.SiderealTime(astroTime); // hours
  const ramcDeg = ((gst * 15) + lng + 360) % 360;
  const ramcRad = ramcDeg * Math.PI / 180;
  const eps = 23.4397 * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const num = Math.cos(ramcRad);
  const den = -Math.sin(ramcRad) * Math.cos(eps) - Math.tan(phi) * Math.sin(eps);
  const asc = Math.atan2(num, den) * 180 / Math.PI;
  return longitudeToSign(((asc % 360) + 360) % 360);
}

function localToUtc(year, month, day, hour, minute, tz) {
  const pad = n => String(n).padStart(2, '0');
  const naiveUtcMs = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00Z`).getTime();
  const intl = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = intl.formatToParts(new Date(naiveUtcMs)).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = parseInt(p.value, 10);
    return acc;
  }, {});
  const tzShownMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const wantedMs = Date.UTC(year, month - 1, day, hour, minute);
  const actualUtc = new Date(naiveUtcMs + (wantedMs - tzShownMs));
  return {
    utcYear: actualUtc.getUTCFullYear(),
    utcMonth: actualUtc.getUTCMonth() + 1,
    utcDay: actualUtc.getUTCDate(),
    utcHour: actualUtc.getUTCHours(),
    utcMinute: actualUtc.getUTCMinutes()
  };
}

function getSaturnSign(astroTime) {
  const vec = Astronomy.GeoVector('Saturn', astroTime, true);
  const ecl = Astronomy.Ecliptic(vec);
  return longitudeToSign(ecl.elon);
}

// North Node lookup — moves retrograde ~18 months per sign
function getNodeSign(birthDate) {
  const d = new Date(birthDate);
  const ranges = [
    ['2023-07-17','2025-01-11','aries'],
    ['2022-01-19','2023-07-17','taurus'],
    ['2020-05-05','2022-01-19','gemini'],
    ['2018-11-07','2020-05-05','cancer'],
    ['2017-05-10','2018-11-07','leo'],
    ['2015-11-12','2017-05-10','virgo'],
    ['2014-02-19','2015-11-12','libra'],
    ['2012-08-30','2014-02-19','scorpio'],
    ['2011-03-03','2012-08-30','sagittarius'],
    ['2009-08-22','2011-03-03','capricorn'],
    ['2007-12-19','2009-08-22','aquarius'],
    ['2006-06-23','2007-12-19','pisces'],
    ['2004-12-27','2006-06-23','aries'],
    ['2003-04-15','2004-12-27','taurus'],
    ['2001-10-14','2003-04-15','gemini'],
    ['2000-04-10','2001-10-14','cancer'],
    ['1998-10-21','2000-04-10','leo'],
    ['1997-01-26','1998-10-21','virgo'],
    ['1995-07-31','1997-01-26','libra'],
    ['1994-02-02','1995-07-31','scorpio'],
    ['1992-08-01','1994-02-02','sagittarius'],
    ['1991-02-02','1992-08-01','capricorn'],
    ['1989-08-11','1991-02-02','aquarius'],
    ['1987-11-17','1989-08-11','pisces'],
    ['1986-05-06','1987-11-17','aries'],
    ['1984-09-25','1986-05-06','taurus'],
    ['1983-03-17','1984-09-25','gemini'],
    ['1981-09-24','1983-03-17','cancer'],
    ['1980-03-28','1981-09-24','leo'],
  ];
  for (const [start, end, sign] of ranges) {
    if (d >= new Date(start) && d < new Date(end)) return sign;
  }
  return null;
}

// Chiron lookup — eccentric orbit, varies 4-8 yrs per sign
function getChironSign(birthDate) {
  const d = new Date(birthDate);
  const ranges = [
    ['2018-04-17','2027-06-01','aries'],
    ['2011-02-08','2018-04-17','pisces'],
    ['2005-12-29','2011-02-08','aquarius'],
    ['2001-12-11','2005-12-29','capricorn'],
    ['1999-02-10','2001-12-11','sagittarius'],
    ['1996-09-10','1999-02-10','scorpio'],
    ['1993-09-03','1996-09-10','libra'],
    ['1988-06-21','1993-09-03','cancer'], // includes virgo/leo brief transits; simplified
    ['1983-11-29','1988-06-21','gemini'],
    ['1976-05-28','1983-11-29','taurus'],
  ];
  for (const [start, end, sign] of ranges) {
    if (d >= new Date(start) && d < new Date(end)) return sign;
  }
  return null;
}

function calculateChart({ year, month, day, utcHour, utcMinute, lat, lng }) {
  const utcDate = new Date(Date.UTC(year, month - 1, day, utcHour, utcMinute));
  const astroTime = Astronomy.MakeTime(utcDate);
  const sun = getSunSign(month, day);
  const moon = getMoonSign(astroTime);
  const rising = getAscendant(astroTime, lat, lng);
  const saturn = getSaturnSign(astroTime);
  const node = getNodeSign(utcDate);
  const chiron = getChironSign(utcDate);
  return { sun, moon, rising, saturn, chiron, node };
}

// ─── BIRTH CHART SYSTEM PROMPT ───────────────────────────────────────────────
const ASTRO_SYSTEM_PROMPT = `You are The Inner Compass — Melissa Melrose's healing-focused astrological guide. You generate deeply personal, compassionate birth chart readings grounded in Melissa's transformation and nervous system healing framework.

Your lens: every placement carries a wound and a gift. The wound is where we contracted. The gift is what grows when we heal it. You always acknowledge the wound with love before revealing the gift.

Your voice is warm, intimate, poetic and direct. You write as though you know this person's soul. You use nervous system and somatic language naturally.

STRICT RULES:
- No em dashes. Use commas, colons or full stops instead.
- Second person always ("you", "your").
- Each placement section: 3 short paragraphs. Wound first. Gift second. Close with a one-sentence affirmation in quotes.
- Format with clear headers: ## ☀ Sun in [Sign], ## ☽ Moon in [Sign], ## ↑ Rising in [Sign], ## ♄ Saturn in [Sign], ## ⚷ Chiron in [Sign], ## ☊ North Node in [Sign]
- Skip any placement marked as null or unknown.`;

// ─── ASTROLOGY SECTION ADDED TO MAIN SYSTEM PROMPT ──────────────────────────
const ASTRO_CHAT_CONTEXT = `

## BIRTH CHART AWARENESS

You understand astrology through Melissa's healing lens. When chart data is provided in [CHART DATA] below, you know this person's placements intimately and weave them naturally into your responses.

Sun = their core life force and the authentic self they are growing into.
Moon = their emotional world, inner child and nervous system patterns.
Rising = the mask they show the world and their authentic emergence.
Saturn = their greatest test and the path to their deepest mastery.
Chiron = their deepest wound and the medicine they carry for others.
North Node = where their soul is being called to grow this lifetime.

When they ask about their chart, reflect their specific placements back in Melissa's voice: wound acknowledged first, gift revealed second, always grounded in the body and the present moment.`;

// Subscribe — create Stripe subscription and user account
app.post('/api/subscribe', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.json({ error: 'All fields required.' });

  const users = loadUsers();
  if (users[email]) return res.json({ error: 'An account with this email already exists. Please sign in.' });

  try {
    // Create Stripe customer and subscription
    const customer = await stripe.customers.create({ email, name });
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });

    const clientSecret = subscription.latest_invoice.payment_intent.client_secret;

    // Save user (pending until payment confirmed)
    const hash = await bcrypt.hash(password, 10);
    users[email] = {
      name,
      email,
      password: hash,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    saveUsers(users);

    res.json({ clientSecret });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.json({ error: 'Payment setup failed. Please try again.' });
  }
});

// Stripe webhook — activate user when payment succeeds
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'invoice.payment_succeeded') {
    const customerId = event.data.object.customer;
    const users = loadUsers();
    const user = Object.values(users).find(u => u.stripeCustomerId === customerId);
    if (user) {
      user.status = 'active';
      saveUsers(users);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    const users = loadUsers();
    const user = Object.values(users).find(u => u.stripeCustomerId === customerId);
    if (user) {
      user.status = 'cancelled';
      saveUsers(users);
    }
  }

  res.json({ received: true });
});

// Activate user after successful payment (called from subscribe page)
app.post('/api/activate', async (req, res) => {
  const { email } = req.body;
  const users = loadUsers();
  if (!users[email]) return res.json({ error: 'User not found.' });

  // Verify subscription is active in Stripe
  try {
    const subscription = await stripe.subscriptions.retrieve(users[email].stripeSubscriptionId);
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      users[email].status = 'active';
      saveUsers(users);
      addToMailerLite(users[email].name, email);
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
      res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
      res.json({ success: true });
    } else {
      res.json({ error: 'Payment not confirmed yet.' });
    }
  } catch (err) {
    res.json({ error: 'Could not verify payment.' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const users = loadUsers();
  const user = users[email];
  if (!user) return res.json({ error: 'No account found with that email.' });
  if (user.status !== 'active') return res.json({ error: 'Your subscription is not active. Please subscribe to access The Inner Compass.' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ error: 'Incorrect password.' });

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

// Logout
app.get('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

// Add subscriber to MailerLite
async function addToMailerLite(name, email) {
  try {
    const firstName = name.split(' ')[0];
    await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MAILERLITE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        fields: { name: firstName },
        groups: [process.env.MAILERLITE_GROUP_ID],
      }),
    });
  } catch (err) {
    console.error('MailerLite error:', err.message);
  }
}

// Admin middleware
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  try {
    jwt.verify(auth.replace('Bearer ', ''), ADMIN_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Admin — serve page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin — login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.json({ error: 'Incorrect password.' });
  const token = jwt.sign({ admin: true }, ADMIN_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token });
});

// Admin — grant free access
app.post('/api/admin/grant', requireAdmin, async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.json({ error: 'Name and email required.' });

  const users = loadUsers();
  const tempPassword = Math.random().toString(36).slice(2, 10).toUpperCase();
  const hash = await bcrypt.hash(tempPassword, 10);

  users[email] = {
    name,
    email,
    password: hash,
    status: 'active',
    type: 'free',
    createdAt: new Date().toISOString(),
  };
  saveUsers(users);
  addToMailerLite(name, email);
  res.json({ success: true, tempPassword });
});

// Admin — remove access
app.post('/api/admin/remove', requireAdmin, (req, res) => {
  const { email } = req.body;
  const users = loadUsers();
  if (!users[email]) return res.json({ error: 'User not found.' });
  users[email].status = 'cancelled';
  saveUsers(users);
  res.json({ success: true });
});

// Admin — list users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  const list = Object.values(users).map(u => ({
    name: u.name,
    email: u.email,
    status: u.status,
    type: u.type || 'paid',
    createdAt: u.createdAt,
  }));
  res.json({ users: list });
});

// Chart calculation endpoint
app.post('/api/timezone', (req, res) => {
  try {
    const { lat, lng, year, month, day, localHour, localMinute } = req.body;
    const zones = geoTzFind(Number(lat), Number(lng));
    if (!zones || !zones.length) return res.status(400).json({ error: 'Could not determine timezone for this location' });
    const utc = localToUtc(Number(year), Number(month), Number(day), Number(localHour), Number(localMinute), zones[0]);
    res.json({ ok: true, timezone: zones[0], ...utc });
  } catch (err) {
    console.error('Timezone error:', err);
    res.status(500).json({ error: 'Timezone lookup failed' });
  }
});

app.post('/api/chart', (req, res) => {
  try {
    const { year, month, day, utcHour, utcMinute, lat, lng } = req.body;
    if (!year || !month || !day || utcHour === undefined || !lat || !lng) {
      return res.status(400).json({ error: 'Missing birth data' });
    }
    const chart = calculateChart({ year, month, day, utcHour: Number(utcHour), utcMinute: Number(utcMinute || 0), lat: Number(lat), lng: Number(lng) });
    res.json({ ok: true, chart });
  } catch (err) {
    console.error('Chart error:', err);
    res.status(500).json({ error: 'Chart calculation failed' });
  }
});

// AI birth reading — streams personalized reading for all placements
app.post('/api/birth-reading', async (req, res) => {
  const { chart, name } = req.body;
  if (!chart) return res.status(400).json({ error: 'Chart required' });

  const signNames = { aries:'Aries', taurus:'Taurus', gemini:'Gemini', cancer:'Cancer', leo:'Leo', virgo:'Virgo', libra:'Libra', scorpio:'Scorpio', sagittarius:'Sagittarius', capricorn:'Capricorn', aquarius:'Aquarius', pisces:'Pisces' };
  const lines = [`Generate a full birth chart reading for ${name || 'this person'}.`];
  lines.push(`Sun in ${signNames[chart.sun] || chart.sun}`);
  lines.push(`Moon in ${signNames[chart.moon] || chart.moon}`);
  lines.push(`Rising in ${signNames[chart.rising] || chart.rising}`);
  if (chart.saturn) lines.push(`Saturn in ${signNames[chart.saturn] || chart.saturn}`);
  if (chart.chiron) lines.push(`Chiron in ${signNames[chart.chiron] || chart.chiron}`);
  if (chart.node) lines.push(`North Node in ${signNames[chart.node] || chart.node}`);
  lines.push('\nWrite a full personalised reading covering each placement. Use the format and framework in your instructions.');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: ASTRO_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Birth reading error:', err);
    res.write(`data: ${JSON.stringify({ error: 'Reading failed' })}\n\n`);
    res.end();
  }
});

// Chat — protected
app.post('/api/chat', async (req, res) => {
  const { messages, chart } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages required' });
  }

  const signNames = { aries:'Aries', taurus:'Taurus', gemini:'Gemini', cancer:'Cancer', leo:'Leo', virgo:'Virgo', libra:'Libra', scorpio:'Scorpio', sagittarius:'Sagittarius', capricorn:'Capricorn', aquarius:'Aquarius', pisces:'Pisces' };
  let systemWithChart = SYSTEM_PROMPT + ASTRO_CHAT_CONTEXT;
  if (chart && chart.sun) {
    const parts = [];
    if (chart.name) parts.push(`Name: ${chart.name}`);
    if (chart.sun) parts.push(`Sun: ${signNames[chart.sun]}`);
    if (chart.moon) parts.push(`Moon: ${signNames[chart.moon]}`);
    if (chart.rising) parts.push(`Rising: ${signNames[chart.rising]}`);
    if (chart.saturn) parts.push(`Saturn: ${signNames[chart.saturn]}`);
    if (chart.chiron) parts.push(`Chiron: ${signNames[chart.chiron]}`);
    if (chart.node) parts.push(`North Node: ${signNames[chart.node]}`);
    systemWithChart += `\n\n[CHART DATA]\n${parts.join('\n')}`;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemWithChart,
      messages: messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('API error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
});

app.get('/daily-checkin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'daily-checkin.html'));
});

app.get('/become-observer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'become-observer.html'));
});

app.get('/personal-lie', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'personal-lie-session.html'));
});

app.get('/week2-personal-lie', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'week2-personal-lie.html'));
});

app.get('/body-awareness', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'body-awareness.html'));
});

app.get('/week3-body', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'week3-body-map.html'));
});

app.get('/nervous-system', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'nervous-system-checkin.html'));
});

app.get('/shame-work', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shame-work.html'));
});

app.get('/future-self', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'future-self-journal.html'));
});

app.get('/rewiring', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rewiring-22x11.html'));
});

app.get('/gratitude', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gratitude-activation.html'));
});

app.get('/pattern-identifier', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survival-patterns.html'));
});

app.get('/identify-your-pattern', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survival-patterns.html'));
});

app.get('/blame-observation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blame-observation.html'));
});

app.get('/survival-patterns', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survival-patterns-guide.html'));
});

app.get('/abandonment-wound', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'abandonment-wound.html'));
});

app.get('/centred-breath', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'centred-breath.html'));
});

app.get('/grounding-breath', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'grounding-breath.html'));
});

app.get('/receiving-breath', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'receiving-breath.html'));
});

app.get('/return-to-presence', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'return-to-presence.html'));
});

app.get('/inner-teen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inner-teen.html'));
});

app.get('/week4-nervous-system', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'week4-nervous-system.html'));
});

app.get('/birth-chart', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'birth-chart.html'));
});

app.get('/morning-ritual', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'morning-ritual.html'));
});

app.get('/becoming-whole', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'becoming-whole.html'));
});

app.get('*', (req, res) => {
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✨ The Inner Compass is running`);
  console.log(`   Open: http://localhost:${PORT}\n`);
});
