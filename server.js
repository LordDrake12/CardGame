const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'webcards-admin';

const db = new Database('webcards.db');
db.pragma('journal_mode = WAL');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      points INTEGER DEFAULT 500,
      free_packs INTEGER DEFAULT 3,
      bonus_packs INTEGER DEFAULT 0,
      luck_boost INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      win_streak INTEGER DEFAULT 0,
      highest_streak INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      quote TEXT NOT NULL,
      source TEXT NOT NULL,
      image_url TEXT NOT NULL,
      tier INTEGER NOT NULL CHECK(tier BETWEEN 0 AND 7),
      codewords TEXT NOT NULL,
      card_number TEXT NOT NULL,
      approved INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hand_slots (
      user_id INTEGER NOT NULL,
      slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 7),
      user_card_id INTEGER,
      PRIMARY KEY(user_id, slot)
    );

    CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      difficulty INTEGER DEFAULT 3,
      reward_points INTEGER DEFAULT 300,
      reward_pack_bonus INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mission_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      team_json TEXT NOT NULL,
      reasoning TEXT,
      result TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pvp_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      team_json TEXT NOT NULL,
      reasoning TEXT,
      status TEXT DEFAULT 'queued',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pvp_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_a INTEGER NOT NULL,
      entry_b INTEGER NOT NULL,
      winner_user_id INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      offered_user_card_id INTEGER NOT NULL,
      requested_user_card_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const missionCount = db.prepare('SELECT COUNT(*) as c FROM missions').get().c;
  if (missionCount === 0) {
    const ins = db.prepare('INSERT INTO missions (title, prompt, difficulty, reward_points, reward_pack_bonus) VALUES (?, ?, ?, ?, ?)');
    ins.run('Emergency Kitchen Rush', 'Assemble a team to make a gourmet burger for a state dinner under pressure.', 6, 550, 2);
    ins.run('Artifact Recovery', 'Build a team to recover an ancient relic from a collapsing temple.', 5, 450, 1);
    ins.run('Diplomatic Summit', 'Choose 7 cards to negotiate peace between rival factions without violence.', 7, 700, 2);
  }

  const cardCount = db.prepare('SELECT COUNT(*) as c FROM cards').get().c;
  if (cardCount === 0) seedCards();
}

function seedCards() {
  const samples = [
    ['Barack Obama', '44th US President', 'Yes we can.', 'History', '/assets/placeholder.svg', 7, 'politics,leader,history', 'WC-0001'],
    ['Satoru Gojo', 'The Strongest Sorcerer', 'Throughout heaven and earth, I alone am the honored one.', 'Jujutsu Kaisen', '/assets/placeholder.svg', 7, 'anime,mentor,power', 'WC-0002'],
    ['Miss Tick', 'Witch & Mentor', 'Wisdom is worth more than silver.', 'A Hat Full of Sky', '/assets/placeholder.svg', 4, 'fantasy,mentor,magic', 'WC-0003'],
    ['Local Chef', 'Neighborhood Grill Master', 'Give me ten minutes and a hot pan.', 'Everyday Life', '/assets/placeholder.svg', 2, 'chef,cooking,common', 'WC-0004'],
    ['Courier Rider', 'Fast Delivery Hero', 'I can get anything anywhere.', 'Urban Tales', '/assets/placeholder.svg', 1, 'transport,urban,speed', 'WC-0005'],
    ['Thanos', 'The Mad Titan', 'Dread it. Run from it. Destiny arrives all the same.', 'Marvel', '/assets/placeholder.svg', 7, 'cosmic,villain,legendary', 'WC-0006'],
    ['Field Medic', 'Emergency Support', 'Stabilized. Keep moving.', 'Rescue Ops', '/assets/placeholder.svg', 3, 'medical,support,teamwork', 'WC-0007'],
    ['Archivist', 'Keeper of Records', 'Everything has a pattern.', 'Library Mythos', '/assets/placeholder.svg', 3, 'knowledge,history,analysis', 'WC-0008'],
    ['Street Artist', 'Color Rebel', 'Walls are just giant canvases.', 'City Beats', '/assets/placeholder.svg', 2, 'creative,urban,style', 'WC-0009'],
    ['Portal Engineer', 'Rift Mechanic', 'If it glows, don\'t touch it yet.', 'Sci-Fi Frontier', '/assets/placeholder.svg', 5, 'science,travel,tech', 'WC-0010']
  ];

  const stmt = db.prepare(`INSERT INTO cards (name,title,quote,source,image_url,tier,codewords,card_number,approved) VALUES (?,?,?,?,?,?,?,?,1)`);
  const tx = db.transaction(() => samples.forEach((c) => stmt.run(...c)));
  tx();
}

migrate();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireAdmin(req, res, next) {
  const u = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!u || !u.is_admin) return res.status(403).json({ error: 'Admin required' });
  next();
}

function getUser(userId) {
  return db.prepare('SELECT id, username, is_admin, points, free_packs, bonus_packs, luck_boost, wins, win_streak, highest_streak FROM users WHERE id = ?').get(userId);
}

function packTierRoll(luckBoost = 0) {
  const roll = Math.random();
  const adjusted = roll * (1 - Math.min(luckBoost, 40) / 100);
  if (adjusted < 0.005) return 7;
  if (adjusted < 0.02) return 6;
  if (adjusted < 0.07) return 5;
  if (adjusted < 0.2) return 4;
  if (adjusted < 0.45) return 3;
  if (adjusted < 0.7) return 2;
  if (adjusted < 0.9) return 1;
  return 0;
}

function openPack({ codeword, luckBoost }) {
  const cards = [];
  const codewordQuery = codeword ? `%${codeword.toLowerCase()}%` : '%';
  for (let i = 0; i < 7; i++) {
    let targetTier = packTierRoll(luckBoost);
    if (i === 0 && targetTier < 3) targetTier = 3 + Math.floor(Math.random() * 2); // guarantee 3-4+
    let card = db.prepare(`SELECT * FROM cards WHERE approved = 1 AND tier = ? AND LOWER(codewords) LIKE ? ORDER BY RANDOM() LIMIT 1`).get(targetTier, codewordQuery);
    if (!card) card = db.prepare('SELECT * FROM cards WHERE approved = 1 AND tier = ? ORDER BY RANDOM() LIMIT 1').get(targetTier);
    if (!card) card = db.prepare('SELECT * FROM cards WHERE approved = 1 ORDER BY RANDOM() LIMIT 1').get();
    cards.push(card);
  }
  return cards;
}

function evaluateTeam(prompt, cards, reasoning, harsh = false) {
  // local scoring fallback. replace with OpenAI call if OPENAI_API_KEY is set.
  const tiers = cards.map((c) => c.tier);
  const base = tiers.reduce((a, b) => a + b, 0) / cards.length;
  const roleBonus = /chef|leader|medic|engineer|mentor|analysis/i.test(cards.map((c) => c.codewords).join(',')) ? 1 : 0;
  const reasoningBonus = reasoning && reasoning.length > 30 ? 1 : 0;
  const harshPenalty = harsh ? 1.5 : 0.5;
  const score = Math.max(1, Math.min(10, Math.round(base + roleBonus + reasoningBonus - harshPenalty + Math.random() * 3)));
  const result = score >= 8 ? 'Exceptional Pass' : score >= 6 ? 'Pass' : 'Fail';
  const notes = `Prompt: ${prompt}. Team average tier ${base.toFixed(1)}.`;
  return { score, result, notes };
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username >=3 and password >=6 required' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.trim(), hash);
    for (let i = 1; i <= 7; i++) db.prepare('INSERT INTO hand_slots (user_id, slot, user_card_id) VALUES (?, ?, NULL)').run(info.lastInsertRowid, i);
    const starter = openPack({ codeword: '', luckBoost: 0 });
    const add = db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)');
    starter.forEach((c) => add.run(info.lastInsertRowid, c.id));
    req.session.userId = info.lastInsertRowid;
    res.json({ ok: true, user: getUser(info.lastInsertRowid), starterCards: starter });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password, adminSecret } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Invalid credentials' });
  if (adminSecret && adminSecret === ADMIN_SECRET) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  req.session.userId = user.id;
  res.json({ ok: true, user: getUser(user.id) });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: getUser(req.session.userId) });
});

app.get('/api/cards/mine', requireAuth, (req, res) => {
  const cards = db.prepare(`
    SELECT uc.id as user_card_id, c.*
    FROM user_cards uc
    JOIN cards c ON c.id = uc.card_id
    WHERE uc.user_id = ?
    ORDER BY c.tier DESC, uc.id DESC
  `).all(req.session.userId);
  const hand = db.prepare(`SELECT hs.slot, hs.user_card_id, c.name FROM hand_slots hs LEFT JOIN user_cards uc ON uc.id = hs.user_card_id LEFT JOIN cards c ON c.id = uc.card_id WHERE hs.user_id = ? ORDER BY hs.slot`).all(req.session.userId);
  res.json({ cards, hand });
});

app.post('/api/hand', requireAuth, (req, res) => {
  const { slots } = req.body;
  if (!Array.isArray(slots) || slots.length !== 7) return res.status(400).json({ error: 'Provide 7 user_card_ids (or null)' });
  const check = db.prepare('SELECT id FROM user_cards WHERE user_id = ? AND id = ?');
  const up = db.prepare('UPDATE hand_slots SET user_card_id = ? WHERE user_id = ? AND slot = ?');
  const tx = db.transaction(() => {
    slots.forEach((ucId, idx) => {
      if (ucId !== null && !check.get(req.session.userId, ucId)) throw new Error(`Invalid card at slot ${idx + 1}`);
      up.run(ucId, req.session.userId, idx + 1);
    });
  });
  try { tx(); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json({ ok: true });
});

app.post('/api/packs/open', requireAuth, (req, res) => {
  const { type = 'points', codeword = '', useLuck = false } = req.body;
  const user = getUser(req.session.userId);
  if (type === 'free' && user.free_packs <= 0) return res.status(400).json({ error: 'No free packs' });
  if (type === 'bonus' && user.bonus_packs <= 0) return res.status(400).json({ error: 'No bonus packs' });
  if (type === 'points' && user.points < 120) return res.status(400).json({ error: 'Not enough points' });
  if (type === 'free') db.prepare('UPDATE users SET free_packs = free_packs - 1 WHERE id = ?').run(user.id);
  if (type === 'bonus') db.prepare('UPDATE users SET bonus_packs = bonus_packs - 1 WHERE id = ?').run(user.id);
  if (type === 'points') db.prepare('UPDATE users SET points = points - 120 WHERE id = ?').run(user.id);

  const boost = useLuck && user.luck_boost > 0 ? 15 : 0;
  if (boost) db.prepare('UPDATE users SET luck_boost = luck_boost - 1 WHERE id = ?').run(user.id);

  const draws = openPack({ codeword, luckBoost: boost });
  const add = db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)');
  draws.forEach((c) => add.run(user.id, c.id));
  res.json({ ok: true, draws, user: getUser(user.id) });
});

app.get('/api/missions', requireAuth, (req, res) => {
  const missions = db.prepare('SELECT * FROM missions ORDER BY difficulty DESC').all();
  const last = db.prepare('SELECT created_at FROM mission_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.session.userId);
  const isAdmin = getUser(req.session.userId).is_admin;
  let cooldownSeconds = 0;
  if (last && !isAdmin) {
    const diff = 3600 - Math.floor((Date.now() - new Date(last.created_at).getTime()) / 1000);
    cooldownSeconds = Math.max(0, diff);
  }
  res.json({ missions, cooldownSeconds });
});

app.post('/api/missions/attempt', requireAuth, (req, res) => {
  const { missionId, userCardIds, reasoning = '' } = req.body;
  if (!Array.isArray(userCardIds) || userCardIds.length !== 7) return res.status(400).json({ error: 'Exactly 7 cards required' });
  const mission = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId);
  if (!mission) return res.status(404).json({ error: 'Mission missing' });
  const user = getUser(req.session.userId);
  if (!user.is_admin) {
    const last = db.prepare('SELECT created_at FROM mission_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.id);
    if (last && (Date.now() - new Date(last.created_at).getTime()) < 3600000) {
      return res.status(400).json({ error: 'Mission on cooldown (1 hour)' });
    }
  }
  const q = db.prepare(`SELECT uc.id as user_card_id, c.* FROM user_cards uc JOIN cards c ON c.id = uc.card_id WHERE uc.user_id = ? AND uc.id IN (${userCardIds.map(() => '?').join(',')})`);
  const cards = q.all(user.id, ...userCardIds);
  if (cards.length !== 7) return res.status(400).json({ error: 'Invalid card selection' });
  const judged = evaluateTeam(mission.prompt, cards, reasoning, true);
  db.prepare('INSERT INTO mission_attempts (mission_id,user_id,team_json,reasoning,result,score) VALUES (?,?,?,?,?,?)').run(mission.id, user.id, JSON.stringify(cards), reasoning, judged.result, judged.score);
  if (judged.result !== 'Fail') {
    const pointGain = mission.reward_points + judged.score * 20;
    const bonusPackGain = judged.result === 'Exceptional Pass' ? mission.reward_pack_bonus + 1 : mission.reward_pack_bonus;
    db.prepare('UPDATE users SET points = points + ?, bonus_packs = bonus_packs + ?, luck_boost = luck_boost + 1 WHERE id = ?').run(pointGain, bonusPackGain, user.id);
  }
  res.json({ ok: true, judged, user: getUser(user.id) });
});

function randomPvpPrompt() {
  const prompts = [
    'Build a rescue team for a mountain avalanche.',
    'Win a cooking tournament judged by alien royalty.',
    'Plan a stealth heist of a cursed artifact.',
    'Lead a chaotic school festival to success.'
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

app.post('/api/pvp/queue', requireAuth, (req, res) => {
  const { userCardIds, reasoning = '' } = req.body;
  if (!Array.isArray(userCardIds) || userCardIds.length !== 7) return res.status(400).json({ error: 'Need 7 cards' });
  const q = db.prepare(`SELECT uc.id as user_card_id, c.* FROM user_cards uc JOIN cards c ON c.id = uc.card_id WHERE uc.user_id = ? AND uc.id IN (${userCardIds.map(() => '?').join(',')})`);
  const cards = q.all(req.session.userId, ...userCardIds);
  if (cards.length !== 7) return res.status(400).json({ error: 'Invalid card selection' });
  const prompt = randomPvpPrompt();
  const entry = db.prepare('INSERT INTO pvp_entries (user_id,prompt,team_json,reasoning,status) VALUES (?, ?, ?, ?, ?)').run(req.session.userId, prompt, JSON.stringify(cards), reasoning, 'queued');

  const other = db.prepare('SELECT * FROM pvp_entries WHERE status = ? AND user_id != ? ORDER BY id ASC LIMIT 1').get('queued', req.session.userId);
  if (!other) return res.json({ ok: true, queued: true, prompt, entryId: entry.lastInsertRowid });

  const mine = db.prepare('SELECT * FROM pvp_entries WHERE id = ?').get(entry.lastInsertRowid);
  const otherCards = JSON.parse(other.team_json);
  const myCards = JSON.parse(mine.team_json);
  const scoreA = evaluateTeam(other.prompt, otherCards, other.reasoning, false);
  const scoreB = evaluateTeam(mine.prompt, myCards, mine.reasoning, false);

  let winner = null;
  if (scoreA.score > scoreB.score) winner = other.user_id;
  else if (scoreB.score > scoreA.score) winner = mine.user_id;

  db.prepare('UPDATE pvp_entries SET status = ? WHERE id IN (?, ?)').run('resolved', other.id, mine.id);
  db.prepare('INSERT INTO pvp_matches (entry_a, entry_b, winner_user_id, notes) VALUES (?, ?, ?, ?)').run(other.id, mine.id, winner, `A:${scoreA.score} B:${scoreB.score}`);

  if (winner) {
    db.prepare('UPDATE users SET wins = wins + 1, win_streak = win_streak + 1, highest_streak = MAX(highest_streak, win_streak + 1), points = points + 180 WHERE id = ?').run(winner);
    const loser = winner === other.user_id ? mine.user_id : other.user_id;
    db.prepare('UPDATE users SET win_streak = 0, points = points + 60 WHERE id = ?').run(loser);
  } else {
    db.prepare('UPDATE users SET points = points + 100 WHERE id IN (?, ?)').run(other.user_id, mine.user_id);
  }

  res.json({ ok: true, matched: true, promptMine: mine.prompt, promptOther: other.prompt, scoreMine: scoreB, scoreOther: scoreA, winnerUserId: winner });
});

app.post('/api/trades/propose', requireAuth, (req, res) => {
  const { toUsername, offeredUserCardId, requestedUserCardId } = req.body;
  const toUser = db.prepare('SELECT id FROM users WHERE username = ?').get(toUsername);
  if (!toUser) return res.status(404).json({ error: 'Recipient not found' });
  const ownsOffer = db.prepare('SELECT 1 FROM user_cards WHERE id = ? AND user_id = ?').get(offeredUserCardId, req.session.userId);
  const targetHas = db.prepare('SELECT 1 FROM user_cards WHERE id = ? AND user_id = ?').get(requestedUserCardId, toUser.id);
  if (!ownsOffer || !targetHas) return res.status(400).json({ error: 'Invalid cards' });
  db.prepare('INSERT INTO trades (from_user_id,to_user_id,offered_user_card_id,requested_user_card_id) VALUES (?,?,?,?)').run(req.session.userId, toUser.id, offeredUserCardId, requestedUserCardId);
  res.json({ ok: true });
});

app.get('/api/trades/incoming', requireAuth, (req, res) => {
  const trades = db.prepare('SELECT * FROM trades WHERE to_user_id = ? AND status = ? ORDER BY id DESC').all(req.session.userId, 'pending');
  res.json({ trades });
});

app.post('/api/trades/respond', requireAuth, (req, res) => {
  const { tradeId, accept } = req.body;
  const trade = db.prepare('SELECT * FROM trades WHERE id = ? AND to_user_id = ? AND status = ?').get(tradeId, req.session.userId, 'pending');
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (!accept) {
    db.prepare('UPDATE trades SET status = ? WHERE id = ?').run('declined', trade.id);
    return res.json({ ok: true });
  }
  const fromOwns = db.prepare('SELECT 1 FROM user_cards WHERE id = ? AND user_id = ?').get(trade.offered_user_card_id, trade.from_user_id);
  const toOwns = db.prepare('SELECT 1 FROM user_cards WHERE id = ? AND user_id = ?').get(trade.requested_user_card_id, trade.to_user_id);
  if (!fromOwns || !toOwns) return res.status(400).json({ error: 'Cards no longer available' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE user_cards SET user_id = ? WHERE id = ?').run(trade.to_user_id, trade.offered_user_card_id);
    db.prepare('UPDATE user_cards SET user_id = ? WHERE id = ?').run(trade.from_user_id, trade.requested_user_card_id);
    db.prepare('UPDATE trades SET status = ? WHERE id = ?').run('accepted', trade.id);
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/cards/submit', requireAuth, (req, res) => {
  const { name, title, quote, source, imageUrl, tier, codewords, cardNumber } = req.body;
  if (!name || !title || !quote || !source || !imageUrl || tier === undefined || !codewords || !cardNumber) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  db.prepare(`INSERT INTO cards (name,title,quote,source,image_url,tier,codewords,card_number,approved,created_by) VALUES (?,?,?,?,?,?,?,?,0,?)`).run(name,title,quote,source,imageUrl,Number(tier),codewords,cardNumber,req.session.userId);
  res.json({ ok: true, message: 'Submitted for admin approval' });
});

app.get('/api/admin/submissions', requireAuth, requireAdmin, (req, res) => {
  const submissions = db.prepare('SELECT * FROM cards WHERE approved = 0 ORDER BY id DESC').all();
  res.json({ submissions });
});

app.post('/api/admin/cards', requireAuth, requireAdmin, (req, res) => {
  const { name, title, quote, source, imageUrl, tier, codewords, cardNumber } = req.body;
  db.prepare(`INSERT INTO cards (name,title,quote,source,image_url,tier,codewords,card_number,approved,created_by) VALUES (?,?,?,?,?,?,?,?,1,?)`).run(name,title,quote,source,imageUrl,Number(tier),codewords,cardNumber,req.session.userId);
  res.json({ ok: true });
});

app.post('/api/admin/submissions/:id/approve', requireAuth, requireAdmin, (req, res) => {
  db.prepare('UPDATE cards SET approved = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/leaderboard', requireAuth, (req, res) => {
  const board = db.prepare('SELECT username,wins,highest_streak,points FROM users ORDER BY wins DESC, highest_streak DESC LIMIT 20').all();
  res.json({ board });
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`WebCards running on http://0.0.0.0:${PORT}`);
});
