/**
 * My Journal 1998 -- prototype backend
 *
 * Scope of this file (deliberately limited):
 *   - Accounts, journal entries, friendships, settings -- all persisted to a local JSON file.
 *   - Tier separation (teen vs adult) enforced at the QUERY layer, not just hidden in the UI.
 *   - A placeholder moderation/crisis check -- keyword based, clearly NOT what should ship.
 *
 * Explicitly OUT of scope, on purpose (see chat for why):
 *   - Real identity verification (KYC / age estimation). "verify" here just flips a flag.
 *   - A real crisis-language classifier. Swap CRISIS_KEYWORDS for a real vendor/model call.
 *   - Auth security (password hashing is a toy SHA-256, no sessions/JWT, no rate limiting).
 *   - HTTPS / production hardening of any kind.
 *
 * Run:  npm install && node server.js
 * Then: curl http://localhost:3000/api/health
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "data.json");
const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // serves index.html at "/"

// Very permissive CORS so the static frontend (opened from file:// or another port) can call this.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ---------------------------------------------------------------- */
/* storage                                                           */
/* ---------------------------------------------------------------- */

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    // A single seeded adult account so the friends screen has something real to
    // demo against (send it a request, accept it, etc.) without extra setup.
    const seed = {
      users: [
        {
          id: "demo-riley",
          displayName: "Riley N.",
          email: "riley@demo.local",
          passwordHash: hashPassword("demo"),
          accountType: "adult",
          verificationStatus: "verified",
          commentsDefault: true,
          anonymousDefault: false,
          createdAt: new Date().toISOString(),
        },
      ],
      entries: [],
      friendships: [],
      nextId: 1,
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function nextId(db) {
  const id = db.nextId;
  db.nextId += 1;
  return String(id);
}
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

/* ---------------------------------------------------------------- */
/* placeholder moderation -- replace with a real vendor/model        */
/* ---------------------------------------------------------------- */

const CRISIS_KEYWORDS = [
  "want to die", "end it all", "kill myself", "no reason to live", "hurt myself",
];
function classifyEntry(text) {
  const lower = text.toLowerCase();
  const crisisHit = CRISIS_KEYWORDS.some((k) => lower.includes(k));
  return {
    crisisFlag: crisisHit,
    crisisTier: crisisHit ? 3 : 0, // stand-in: real system would have tiers 1/2/3, see chat
  };
}

/* ---------------------------------------------------------------- */
/* helpers                                                           */
/* ---------------------------------------------------------------- */

function publicUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}
function findUser(db, userId) {
  return db.users.find((u) => u.id === userId);
}
function requireUser(db, req, res) {
  const bodyUserId = req.body && req.body.userId;
  const u = findUser(db, bodyUserId || req.query.userId || req.params.userId);
  if (!u) {
    res.status(401).json({ error: "Unknown or missing userId." });
    return null;
  }
  return u;
}

/* ---------------------------------------------------------------- */
/* accounts                                                          */
/* ---------------------------------------------------------------- */

// Create an account. Tier is not yet known -- set during /api/verify.
app.post("/api/signup", (req, res) => {
  const { displayName, email, password } = req.body;
  if (!displayName || !email || !password) {
    return res.status(400).json({ error: "displayName, email, and password are required." });
  }
  const db = loadDb();
  if (db.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  const user = {
    id: nextId(db),
    displayName,
    email,
    passwordHash: hashPassword(password),
    accountType: null,          // "teen" | "adult" -- set on verify, then immutable
    verificationStatus: "pending",
    commentsDefault: true,
    anonymousDefault: false,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  saveDb(db);
  res.status(201).json(publicUser(user));
});

// Simulated verification. In production this sets accountType from a KYC/age-estimation
// vendor webhook, never from a value the client sends unchecked.
app.post("/api/verify", (req, res) => {
  const { userId, birthYear } = req.body;
  const db = loadDb();
  const user = findUser(db, userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.accountType) {
    return res.status(409).json({ error: "Account type is already verified and cannot change." });
  }
  const age = new Date().getFullYear() - Number(birthYear);
  user.accountType = age < 18 ? "teen" : "adult";
  user.verificationStatus = "verified";
  user.commentsDefault = user.accountType === "teen" ? false : true;
  saveDb(db);
  res.json(publicUser(user));
});

app.get("/api/users/:userId", (req, res) => {
  const db = loadDb();
  const user = findUser(db, req.params.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json(publicUser(user));
});

app.patch("/api/users/:userId/settings", (req, res) => {
  const db = loadDb();
  const user = findUser(db, req.params.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  const { commentsDefault, anonymousDefault } = req.body;
  if (typeof commentsDefault === "boolean") user.commentsDefault = commentsDefault;
  if (typeof anonymousDefault === "boolean") user.anonymousDefault = anonymousDefault;
  saveDb(db);
  res.json(publicUser(user));
});

/* ---------------------------------------------------------------- */
/* journal entries -- tier separation enforced here                  */
/* ---------------------------------------------------------------- */

app.post("/api/entries", (req, res) => {
  const db = loadDb();
  const user = requireUser(db, req, res);
  if (!user) return;
  if (!user.accountType) return res.status(403).json({ error: "Account is not verified yet." });

  const { text, anonymous, commentsAllowed } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Entry text is required." });

  const classification = classifyEntry(text);
  const entry = {
    id: nextId(db),
    authorId: user.id,
    accountType: user.accountType, // entries are stamped with the tier they belong to
    text,
    anonymous: !!anonymous,
    commentsAllowed: user.accountType === "teen" ? !!commentsAllowed : commentsAllowed !== false,
    crisisFlag: classification.crisisFlag,
    crisisTier: classification.crisisTier,
    reactions: {},
    createdAt: new Date().toISOString(),
  };
  db.entries.push(entry);
  saveDb(db);
  res.status(201).json(entry);
});

// The feed query is the enforcement point: a teen account can never receive an adult entry
// and vice versa, regardless of what the client asks for.
app.get("/api/feed", (req, res) => {
  const db = loadDb();
  const user = requireUser(db, req, res);
  if (!user) return;
  if (!user.accountType) return res.status(403).json({ error: "Account is not verified yet." });

  const entries = db.entries
    .filter((e) => e.accountType === user.accountType)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((e) => ({
      ...e,
      authorDisplay: e.anonymous ? "Anonymous" : findUser(db, e.authorId)?.displayName || "Unknown",
    }));
  res.json(entries);
});

app.get("/api/entries/mine", (req, res) => {
  const db = loadDb();
  const user = requireUser(db, req, res);
  if (!user) return;
  res.json(db.entries.filter((e) => e.authorId === user.id));
});

/* ---------------------------------------------------------------- */
/* friendships -- adult tier only, request must be mutual            */
/* ---------------------------------------------------------------- */

app.post("/api/friends/request", (req, res) => {
  const db = loadDb();
  const requester = requireUser(db, req, res);
  if (!requester) return;
  const recipient = findUser(db, req.body.recipientId);
  if (!recipient) return res.status(404).json({ error: "Recipient not found." });
  if (requester.accountType !== "adult" || recipient.accountType !== "adult") {
    return res.status(403).json({ error: "Friend requests are only available between verified adults." });
  }
  const exists = db.friendships.find(
    (f) =>
      (f.requesterId === requester.id && f.recipientId === recipient.id) ||
      (f.requesterId === recipient.id && f.recipientId === requester.id)
  );
  if (exists) return res.status(409).json({ error: "A request or friendship already exists." });

  const friendship = { id: nextId(db), requesterId: requester.id, recipientId: recipient.id, status: "pending" };
  db.friendships.push(friendship);
  saveDb(db);
  res.status(201).json(friendship);
});

app.post("/api/friends/:friendshipId/accept", (req, res) => {
  const db = loadDb();
  const friendship = db.friendships.find((f) => f.id === req.params.friendshipId);
  if (!friendship) return res.status(404).json({ error: "Request not found." });
  friendship.status = "accepted";
  saveDb(db);
  res.json(friendship);
});

app.get("/api/friends", (req, res) => {
  const db = loadDb();
  const user = requireUser(db, req, res);
  if (!user) return;
  const mine = db.friendships.filter((f) => f.requesterId === user.id || f.recipientId === user.id);
  res.json(mine);
});

/* ---------------------------------------------------------------- */

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`My Journal 1998 API listening on http://localhost:${PORT}`));
