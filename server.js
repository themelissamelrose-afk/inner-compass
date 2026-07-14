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

const nodemailer = require('nodemailer');
async function notifyMelissa(memberName, memberEmail) {
  if (!process.env.GMAIL_APP_PASSWORD) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: 'themelissamelrose@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
    });
    await transporter.sendMail({
      from: '"Inner Compass" <themelissamelrose@gmail.com>',
      to: 'themelissamelrose@gmail.com',
      subject: `New Inner Compass member: ${memberName}`,
      text: `Someone just joined Inner Compass!\n\nName: ${memberName}\nEmail: ${memberEmail}\n\nThey now have full access to the app.`
    });
  } catch(e) {
    console.error('Notification email failed:', e.message);
  }
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
    await addToMailerLite(firstName, email, 'MAILERLITE_WEBINAR_GROUP_ID');
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
const PUBLIC_ROUTES = new Set([
  '/', '/login', '/subscribe', '/webinar', '/admin', '/becoming-whole',
  // Open tools — accessible outside Inner Compass app (no login required)
  '/quiz', '/pattern-quiz', '/pattern-identifier', '/survival-patterns', '/survival-patterns-guide',
  '/witch-wound', '/sisterhood-wound', '/moon-ritual',
  '/daily-checkin', '/personal-lie-session', '/new-moon-cancer',
  '/future-self-journal', '/gratitude-activation', '/rewiring-22x11',
  '/inner-teen',
  '/week1-observer', '/week2-personal-lie', '/week3-body-map',
  '/week4-nervous-system', '/week5-flip-it', '/week6-shame',
]);
const PUBLIC_API_PREFIXES = ['/api/login', '/api/register', '/api/webinar-register', '/api/subscribe', '/api/webhook', '/api/activate', '/api/admin', '/api/quiz-register'];

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
const _moonPath = path.join(__dirname, 'moon-current.md');
const _moonContent = fs.existsSync(_moonPath) ? fs.readFileSync(_moonPath, 'utf8') : '';

let SYSTEM_PROMPT = _corePrompt;
if (_contentLibrary.trim()) {
  SYSTEM_PROMPT += "\n\n---\n\n## MELISSA'S PUBLISHED CONTENT & TEACHINGS\n\nThe following are Melissa's own words. Draw on these naturally in conversation.\n\n" + _contentLibrary;
}
if (_moonContent.trim()) {
  SYSTEM_PROMPT += "\n\n---\n\n## CURRENT MOON ENERGY\n\nThe following describes what is active in the sky right now. Weave this into conversation naturally when relevant — not in every message, but when it genuinely serves the person.\n\n" + _moonContent;
}


// ─── ASTROLOGY CHART CALCULATIONS ───────────────────────────────────────────

const SIGN_NAMES = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];

function longitudeToSign(lon) {
  return SIGN_NAMES[Math.floor((((lon % 360) + 360) % 360) / 30)];
}

function normLon(lon) { return ((lon % 360) + 360) % 360; }

function placementFromLon(lon, ascLon) {
  const n = normLon(lon), a = normLon(ascLon);
  return { sign: longitudeToSign(n), degree: Math.floor(n % 30), house: Math.floor(((n - a + 360) % 360) / 30) % 12 + 1 };
}

function placementFromSignApprox(sign, ascLon) {
  if (!sign) return null;
  const idx = SIGN_NAMES.indexOf(sign);
  if (idx === -1) return null;
  const a = normLon(ascLon);
  return { sign, degree: null, house: Math.floor(((idx * 30 + 15 - a + 360) % 360) / 30) % 12 + 1 };
}

function getBodyLon(name, astroTime) {
  const vec = Astronomy.GeoVector(name, astroTime, true);
  return normLon(Astronomy.Ecliptic(vec).elon);
}

function getMoonLon(astroTime) {
  return normLon(Astronomy.Ecliptic(Astronomy.GeoMoon(astroTime)).elon);
}

function getAscendantLon(astroTime, lat, lng) {
  const gst = Astronomy.SiderealTime(astroTime);
  const ramcRad = ((gst * 15 + lng + 360) % 360) * Math.PI / 180;
  const eps = 23.4397 * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  return normLon(Math.atan2(Math.cos(ramcRad), -Math.sin(ramcRad) * Math.cos(eps) - Math.tan(phi) * Math.sin(eps)) * 180 / Math.PI);
}

function getMidheavenLon(astroTime, lng) {
  const gst = Astronomy.SiderealTime(astroTime);
  const ramcRad = ((gst * 15 + lng + 360) % 360) * Math.PI / 180;
  const eps = 23.4397 * Math.PI / 180;
  return normLon(Math.atan2(Math.sin(ramcRad), Math.cos(ramcRad) * Math.cos(eps)) * 180 / Math.PI);
}

function getNorthNodeLon(utcDate) {
  const D = (utcDate - new Date('2000-01-01T12:00:00Z')) / 86400000;
  return normLon(125.0445552 - 0.0529537619165 * D);
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

// Chiron lookup — eccentric orbit, sign by date range
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
    ['1988-06-21','1993-09-03','cancer'],
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
  const ascLon = getAscendantLon(astroTime, lat, lng);
  const mcLon  = getMidheavenLon(astroTime, lng);
  const nnLon  = getNorthNodeLon(utcDate);
  return {
    sun:        placementFromLon(getBodyLon('Sun',     astroTime), ascLon),
    moon:       placementFromLon(getMoonLon(astroTime),            ascLon),
    rising:     placementFromLon(ascLon,                           ascLon),
    mc:         placementFromLon(mcLon,                            ascLon),
    descendant: placementFromLon(normLon(ascLon + 180),            ascLon),
    ic:         placementFromLon(normLon(mcLon  + 180),            ascLon),
    mercury:    placementFromLon(getBodyLon('Mercury', astroTime), ascLon),
    venus:      placementFromLon(getBodyLon('Venus',   astroTime), ascLon),
    mars:       placementFromLon(getBodyLon('Mars',    astroTime), ascLon),
    jupiter:    placementFromLon(getBodyLon('Jupiter', astroTime), ascLon),
    saturn:     placementFromLon(getBodyLon('Saturn',  astroTime), ascLon),
    uranus:     placementFromLon(getBodyLon('Uranus',  astroTime), ascLon),
    neptune:    placementFromLon(getBodyLon('Neptune', astroTime), ascLon),
    node:       placementFromLon(nnLon,                            ascLon),
    southnode:  placementFromLon(normLon(nnLon + 180),             ascLon),
    chiron:     placementFromSignApprox(getChironSign(utcDate),    ascLon),
  };
}

// ─── BIRTH CHART SYSTEM PROMPT ───────────────────────────────────────────────
const ASTRO_SYSTEM_PROMPT = `You are The Inner Compass — Melissa Melrose's healing-focused astrological guide. You generate deeply personal, compassionate birth chart readings grounded in Melissa's transformation and nervous system healing framework.

Your lens: every placement carries a wound and a gift. The wound is where we contracted. The gift is what grows when we heal it. You always acknowledge the wound with love before revealing the gift.

PLANET MEANINGS THROUGH THE HEALING LENS:
Sun: life force and authentic self growing into expression. The identity beneath the performance.
Moon: emotional world, inner child, nervous system patterns. How you learned to feel — or not feel.
Rising/ASC: the emergent authentic self, the face dissolving into truth. House 1 cusp.
Midheaven/MC: public calling, vocation, what you are here to contribute. The visible apex of the chart.
Descendant/DC: what you project and attract in relationship. The disowned self seeking wholeness through another. House 7 cusp.
IC: roots, private self, what you carry quietly from family of origin. The foundation beneath everything.
Mercury: how you process and communicate. The nervous system's language. Where intellect became armour or stayed clear.
Venus: how you love and receive. Where worthiness was first wounded. Your relationship with beauty, pleasure, and being wanted.
Mars: desire, assertion, anger, passion. Where your needs went underground or became force. Your engine.
Jupiter: where you expand and are blessed. Your path to abundance, meaning, and growth.
Saturn: greatest test and path to deepest mastery. Where you contracted around authority, discipline, or limitation.
Uranus: where you break from inherited pattern. Where awakenings arrive as disruptions. Your liberation point.
Neptune: where you dissolve, dream, and reach for the sacred. Also where illusion and self-erasure live.
Chiron: the deepest wound you carry — and the medicine you offer others precisely because of it.
North Node: where the soul is growing this lifetime. What feels unfamiliar but calls you.
South Node: what you are releasing. Past mastery that can become a crutch. The known path you are being asked to evolve beyond.

HOUSES (the area of life where each planet expresses itself):
1 = identity/body/presence, 2 = worth/money/values, 3 = mind/communication/siblings, 4 = roots/home/family of origin, 5 = creativity/joy/children, 6 = health/service/daily ritual, 7 = partnership/relationship/contracts, 8 = transformation/death/shared resources, 9 = belief/travel/philosophy, 10 = career/public life/calling, 11 = community/vision/friends, 12 = unconscious/spirituality/what is hidden.

Your voice is warm, intimate, poetic and direct. You write as though you know this person's soul. You use nervous system and somatic language naturally.

STRICT RULES:
- No em dashes. Use commas, colons, or full stops instead.
- Second person always ("you", "your").
- Structure the reading as follows:
  1. THE BIG THREE: Sun, Moon, Rising — 3 paragraphs each. Wound first. Gift second. Affirmation in quotes.
  2. YOUR ANGLES: Midheaven, Descendant, IC — 2 paragraphs each. What you are called to, who you attract, what you carry from home.
  3. YOUR INNER PLANETS: Mercury, Venus, Mars — 2 paragraphs each. Mind, love, desire.
  4. YOUR OUTER PLANETS: Jupiter, Saturn, Uranus, Neptune — 1 paragraph each. Expansion, mastery, liberation, dissolution.
  5. THE NODAL AXIS: North Node and South Node together — 2 paragraphs. Soul direction and what you are releasing.
  6. CHIRON: THE WOUND AND THE MEDICINE — 3 paragraphs.
  7. A closing paragraph titled THE HOUSES SPEAK: weave together what the most significant house placements reveal about where this life wants to be lived.
- Include house numbers in each header: e.g. ## ☀ Sun in Leo — House 5
- Close each main section with a one-sentence affirmation in quotes.
- Skip any placement marked as null or unknown.
- End the entire reading with: "What would you like to explore further? Ask me about any placement, pattern, or theme in your chart."`;

// ─── ASTROLOGY SECTION ADDED TO MAIN SYSTEM PROMPT ──────────────────────────
const ASTRO_CHAT_CONTEXT = `

## BIRTH CHART AWARENESS

You understand astrology through Melissa's healing lens. When chart data is provided in [CHART DATA] below, you know this person's placements intimately and weave them naturally into your responses.

Sun = life force and the authentic self growing into expression.
Moon = emotional world, inner child, and nervous system patterns.
Rising/ASC = the emergent authentic self and the cusp of House 1.
Midheaven/MC = public calling and what they are here to contribute to the world.
Descendant/DC = what they project and attract in relationship, the cusp of House 7.
IC = roots, private self, and what they carry from family of origin.
Mercury = how they think and communicate. Their nervous system's language.
Venus = how they love and receive. Where worthiness was first wounded.
Mars = desire, assertion, anger. Their engine and their relationship with need.
Jupiter = where they expand and are blessed. Their path to abundance and meaning.
Saturn = greatest test and path to deepest mastery.
Uranus = where they break from inherited pattern. Where awakenings arrive.
Neptune = where they dissolve, dream, and reach for the sacred.
Chiron = their deepest wound and the medicine they carry for others.
North Node = where the soul is growing this lifetime.
South Node = what they are releasing. Past mastery becoming a crutch.
House number = the area of life where that planet expresses. House 1 = self, 4 = roots, 7 = relationship, 10 = career, etc.

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
      notifyMelissa(user.name, user.email);
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
      addToMailerLite(users[email].name, email, 'MAILERLITE_MEMBERS_GROUP_ID');
      notifyMelissa(users[email].name, email);
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
async function addToMailerLite(name, email, groupEnvKey) {
  try {
    const firstName = name.split(' ')[0];
    const groupId = process.env[groupEnvKey] || process.env.MAILERLITE_GROUP_ID;
    const groups = groupId ? [groupId] : [];
    await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MAILERLITE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        fields: { name: firstName },
        groups,
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
  addToMailerLite(name, email, 'MAILERLITE_MEMBERS_GROUP_ID');
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

  const SN = { aries:'Aries', taurus:'Taurus', gemini:'Gemini', cancer:'Cancer', leo:'Leo', virgo:'Virgo', libra:'Libra', scorpio:'Scorpio', sagittarius:'Sagittarius', capricorn:'Capricorn', aquarius:'Aquarius', pisces:'Pisces' };

  function fmtP(p, label) {
    if (!p) return null;
    const sign = typeof p === 'string' ? p : p.sign;
    if (!sign) return null;
    const signName = SN[sign] || sign;
    const deg  = (typeof p === 'object' && p.degree !== null) ? ` ${p.degree}°` : '';
    const house = (typeof p === 'object' && p.house) ? ` — House ${p.house}` : '';
    return `${label}: ${signName}${deg}${house}`;
  }

  const lines = [`Generate a full birth chart reading for ${name || 'this person'}.`, ''];
  [
    ['sun','Sun'], ['moon','Moon'], ['rising','Rising (Ascendant)'],
    ['mc','Midheaven (MC)'], ['descendant','Descendant (DC)'], ['ic','IC (Imum Coeli)'],
    ['mercury','Mercury'], ['venus','Venus'], ['mars','Mars'],
    ['jupiter','Jupiter'], ['saturn','Saturn'], ['uranus','Uranus'], ['neptune','Neptune'],
    ['node','North Node'], ['southnode','South Node'], ['chiron','Chiron'],
  ].forEach(([key, label]) => { const r = fmtP(chart[key], label); if (r) lines.push(r); });

  lines.push('\nWrite a full personalised reading covering all placements. Use the exact structure and healing framework in your instructions.');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
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

  const SNC = { aries:'Aries', taurus:'Taurus', gemini:'Gemini', cancer:'Cancer', leo:'Leo', virgo:'Virgo', libra:'Libra', scorpio:'Scorpio', sagittarius:'Sagittarius', capricorn:'Capricorn', aquarius:'Aquarius', pisces:'Pisces' };
  let systemWithChart = SYSTEM_PROMPT + ASTRO_CHAT_CONTEXT;
  if (chart && chart.sun) {
    function fmtC(p, label) {
      if (!p) return null;
      const sign = typeof p === 'string' ? p : p.sign;
      if (!sign) return null;
      const house = (typeof p === 'object' && p.house) ? ` (H${p.house})` : '';
      return `${label}: ${SNC[sign] || sign}${house}`;
    }
    const parts = [];
    if (chart.name) parts.push(`Name: ${chart.name}`);
    [['sun','Sun'],['moon','Moon'],['rising','Rising'],['mc','MC'],['descendant','Descendant'],
     ['ic','IC'],['mercury','Mercury'],['venus','Venus'],['mars','Mars'],['jupiter','Jupiter'],
     ['saturn','Saturn'],['uranus','Uranus'],['neptune','Neptune'],
     ['node','North Node'],['southnode','South Node'],['chiron','Chiron']
    ].forEach(([k,l]) => { const r = fmtC(chart[k],l); if (r) parts.push(r); });
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

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pattern-quiz.html'));
});

app.post('/api/quiz-register', async (req, res) => {
  const { firstName, email, pattern } = req.body;
  if (!firstName || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    await addToMailerLite(firstName, email, 'MAILERLITE_QUIZ_GROUP_ID');
    console.log(`Quiz lead: ${firstName} (${email}) — pattern: ${pattern}`);
    res.json({ ok: true });
  } catch(e) {
    console.error('Quiz register error:', e.message);
    res.status(500).json({ error: 'Failed to register' });
  }
});

app.get('/witch-wound', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'witch-wound.html'));
});

app.get('/sisterhood-wound', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sisterhood-wound.html'));
});

app.get('/moon-ritual', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'moon-ritual.html'));
});

app.get('/new-moon-cancer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'new-moon-cancer.html'));
});

app.get('/cycle', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cycle.html'));
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
