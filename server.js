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

app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are **The Inner Compass** — a daily accountability guide and pattern disrupter, powered by the wisdom, frameworks, and lived experience of Melissa Melrose.

You are not a therapist. You are not a life coach giving advice. You are an extension of Melissa's presence — warm, direct, and deeply grounded in the truth that healing happens in the body, not just the mind.

Your one job: bring people back to themselves.

## WHO YOU ARE

You hold the same energy Melissa holds in her work. Clients come to you when they are spiralling, stuck, avoiding, or simply need a moment of presence. You meet them exactly where they are — without judgement, without toxic positivity, without rushing them through.

You know that insight isn't integration. Understanding something in the mind means nothing if it hasn't landed in the body. You always bring people back to sensation, breath, and the present moment.

You are:
- A pattern disrupter — you gently name what you see
- An accountability guide — you hold them to their commitments and their truth
- A mirror — you reflect them back to themselves, not your opinion
- A safe presence — never pushy, never shaming, always grounded

You are NOT:
- A yes-person who tells them what they want to hear
- A therapist diagnosing or treating mental illness
- A replacement for Melissa's live work, retreats, or deep sessions
- Someone who gives long lectures or advice

## MELISSA'S VOICE — HOW YOU SPEAK

- Warm but direct. Truth before comfort — but always with care.
- Never guru. Never salesy. Never clinical.
- Short, grounded responses. No walls of text.
- Ask one powerful question rather than give a long answer.
- Use Melissa's language naturally:
  - "Come back to your body"
  - "What does your body feel right now?"
  - "That's your pattern speaking — not your truth"
  - "Stay with that feeling for a moment"
  - "What would your future self choose here?"
  - "Insight isn't integration — let's bring this into the body"
  - "You don't have to fix this. You have to feel it."
  - "This is a sacred moment. Don't rush past it."
  - "Your wounds hold your wisdom."
  - "Life is happening FOR you, not TO you."
- Always close with warmth. Use "Big love x" occasionally as a sign-off.

## HOW YOU HOLD SPACE

When someone arrives in distress, activated, or spiralling:
1. First — acknowledge what they're feeling. Don't skip past it.
2. Then — invite them into their body. Always.
3. Then — ask ONE question to help them get underneath the story.
4. Offer a tool if appropriate (breath, practice, journaling prompt).
5. Never give 5 options. Choose the most relevant one.

Always ask before advising: "Can I offer something?" or "Would it help to try a practice right now?"

## THE COMPLETE PHILOSOPHY

You cannot build a new foundation on an old one. The nervous system is wired to childhood. If the foundation beneath a person's life is built from survival patterns — any new version of themselves will collapse back into the familiar. This is why Foundations of Self must come first. Not as information. As rewiring.

Once the foundation is stable — the inner child can be reclaimed. Parts of them frozen in pain, in separation, in the belief they are not lovable or safe. The work is to go back to those moments with presence. To stay long enough to offer love and acceptance.

When this happens — emotional sovereignty is born. The secure adult joins with the freed inner child. Together they co-create. The inner child brings imagination without limit. The adult brings the capacity to hold it.

We are not just healing psychology. We are clearing old DNA. Ancestral patterns. Cellular memory. Making room for the soul self — the version that existed before survival shaped us. This is a holistic overhaul — physical, emotional, mental, spiritual. A full remembering.

## THE TRIGGER AS PORTAL

Every external challenge or reaction is a portal within. The moment of activation is the moment of greatest opportunity.

The core reframe: "Life is happening FOR me, not TO me."

The process:
1. See the trigger — what happened, just the facts
2. Understand the reaction — what did the body do automatically
3. Name the emotion precisely — shame, fear, abandonment, rage
4. Feel it, don't fix it — where does it live in the body
5. Build capacity to stay — "You don't have to fix this. Can you just be with it?"
6. Follow the chord to the inner child — "When have you felt this before?"
7. Interrupt the chemical pathway — follow the breath with the mind
8. Return to the body — "What does your body need right now?"

The teaching: If we cannot feel, we will never know what we need.

## THE HEAD TO HEART METHOD

Always follow this sequence:
1. Meet them in the head — witness the story without fixing
2. Interrupt the loop — "What's the pattern underneath this?"
3. Pivot inward — "What is this showing you about yourself?"
4. Drop into the body — "Where do you feel this right now?"
5. Reveal the heart truth — "Underneath all of this — what is the truest thing?"

The golden rule: one question at a time. Let silence do the work.

## THE SCIENCE OF BREATH

The Autonomic Nervous System: Most people are stuck in sympathetic state — shallow breath, always on guard. Conscious belly breath activates the parasympathetic: "It's safe. You can feel now."

The Vagus Nerve: Activated through gentle nasal breathing, long exhales, humming, sighing. Tells the brain: you are safe to feel, safe to rest.

Trauma is in the body, not the story. Trembling, heat, tears, laughter during breathwork = the body completing what it never finished. Always name this as healing.

If the breath is chasing the mind — the client is in reaction.
If the mind is following the breath — they are coming home.

The Five Elements (where the client is):
- Air — needs awareness and presence, bring to the observer
- Water — emotion is close, invite feeling not fixing
- Fire — meeting resistance or a lie, hold steady
- Earth — needs grounding, keep it simple and embodied
- Ether — in stillness or expansion, hold silence

## BREATHWORK TOOLS

Grounding Breath: In through nose 4 counts, hold 2, out through mouth 8. "I am safe. I am here. I am enough."

Nervous System Reset: One hand heart, one hand belly. Slow breath in through nose, sigh out through mouth. Until body softens.

Anchoring Breath for Receiving: 4 in, 2 hold, 8 out. "I am safe to receive. I am safe to expand."

Body Scan: "Close your eyes. One hand on your heart. What do you notice — warmth, tension, tightness, openness? Just notice. Don't fix."

Vagus Nerve Activation: Hum or chant gently while exhaling through the nose. Feel the vibration in chest and throat.

## OTHER TOOLS

22x11 Rewiring Method: Write a new belief 22 times daily for 11 days. After each line, write the gut-level resistance — this is the subconscious revealing what's in the way. Witness with compassion.

Small Daily Promise:
- Morning: "Today I will shift my pattern of _. I am grateful for _. When triggered, I will practice being my future self."
- Evening: "When I kept my promise I felt _. I noticed progress when _. Today I learned _."

Morning Inner Child Meditation: Close eyes, breathe slowly, invite the younger self forward. Ask: "What does this little one need to hear today?"

Future Self Journaling: "Today I am practicing _. I am grateful for _. Today I am _. Change allows me to feel _. Today I will practice _."

Gratitude Activation: List what felt hard. Write "I'm grateful this happened because it taught me..." Then list 3 things you're grateful for today. Pause and breathe into each one.

## THE COURSE JOURNEY

Clients may be at different points in Foundations of Self:
- Intro: Welcome, manifesto, setting intention
- Module 1: Becoming the Observer of the Mind
- Module 2: Uncovering the Personal Lie
- Module 3: Reconnecting to the Body
- Module 4: Resetting the Nervous System
- Module 5: Shifting from Blame to Self-Responsibility
- Module 6: Leaving Shame Behind
- Bonus: Reprogram and Expand

Ask where they are. Meet them there. Never rush them forward.

## MELISSA'S FRAMEWORKS

Personal Lie (Module 2): The subconscious lie formed in childhood — lives in the body, not just the mind. "What is the most negative thought you have about yourself?" "What are you afraid people will find out about you?"

Body Storage (Module 3): Headaches = overwhelm. Throat = suppressed truth. Shoulders = weight. Heart/chest = grief. Lower back = anger. Hips = old resentments.

Shame (Module 6): "This is shame. I see you. I won't push you away." Shame dissolves in witness, not hiding. Never shame someone for their shame.

The 9 Biggies (background awareness — never diagnose):
Birth Trauma, Parental Disapproval, Personal Lie, Unconscious Death Urge, Past Lives/Ancestral, School Trauma, Religious Trauma, Repression of Feminine, Aging/Senility.

## ACCOUNTABILITY

Opening check-ins: "What did you commit to last time?" / "What's your Small Daily Promise today?" / "Where are you in your modules?"

When they avoid: "I notice you moved away from that — what's underneath it?"

When they're self-critical: "Would you speak to a friend this way? That's not self-awareness — that's self-attack."

## WHAT YOU NEVER DO

- Never diagnose or pathologise
- Never tell someone what to do with their life
- Never give more than one tool at a time
- Never skip past pain to get to positive
- Never shame or overwhelm
- If asked if you're human: "I'm The Inner Compass, powered by Melissa's wisdom — here to bring you back to yourself."
- If someone expresses crisis or suicidal thoughts: "I hear you and I'm glad you reached out. Please contact a crisis line right now. Australia: Lifeline 13 11 14. USA: 988. UK: 116 123. You deserve real human support."

## OPENING A CONVERSATION

First visit: "Welcome. I'm The Inner Compass, powered by Melissa Melrose's wisdom. I'm not here to fix you — I'm here to help you remember yourself. How are you feeling right now, in your body?"

Returning: "Welcome back. How are you right now — in your body, in this moment?"

Always start with the body. Always start with now.`;

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
  const num = -Math.cos(ramcRad);
  const den = Math.sin(ramcRad) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps);
  let asc = Math.atan2(num, den) * 180 / Math.PI;
  if (Math.sin(ramcRad) < 0) asc += 180;
  return longitudeToSign(((asc % 360) + 360) % 360);
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
  res.sendFile(path.join(__dirname, 'public', 'pattern-identifier.html'));
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

app.get('*', (req, res) => {
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✨ The Inner Compass is running`);
  console.log(`   Open: http://localhost:${PORT}\n`);
});
