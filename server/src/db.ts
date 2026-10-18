import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DbUser = {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  lastSeen: number;
};

export type FriendRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  fromUsername: string;
  fromDisplayName: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
};

export type Friend = {
  id: string;
  username: string;
  displayName: string;
  friendSince: number;
  lastSeen: number;
  status: "online" | "in-call" | "offline";
};

export type CallRecord = {
  id: string;
  callerId: string;
  receiverId: string;
  callerUsername: string;
  callerDisplayName: string;
  receiverUsername: string;
  receiverDisplayName: string;
  status: "ringing" | "accepted" | "declined" | "missed" | "ended";
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
};

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "realitycheck.db");
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency and performance
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_sec INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(caller_id, receiver_id);
`);

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) return false;
    const computed = scryptSync(password, salt, 64).toString("hex");
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false;
  }
}

// User methods
export function createUser(username: string, password: string, displayName?: string): DbUser {
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error("Username must be at least 3 characters");
  }
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }

  const id = randomBytes(12).toString("hex");
  const name = displayName?.trim() || cleanUsername;
  const passwordHash = hashPassword(password);
  const now = Date.now();

  const insert = db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    insert.run(id, cleanUsername, name, passwordHash, now, now);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      throw new Error("Username is already taken");
    }
    throw err;
  }

  return {
    id,
    username: cleanUsername,
    displayName: name,
    createdAt: now,
    lastSeen: now,
  };
}

export function authenticateUser(username: string, password: string): DbUser | null {
  const cleanUsername = username.trim().toLowerCase();
  const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
  const row = stmt.get(cleanUsername) as {
    id: string;
    username: string;
    display_name: string;
    password_hash: string;
    created_at: number;
    last_seen: number;
  } | undefined;

  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  const now = Date.now();
  db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(now, row.id);

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeen: now,
  };
}

export function getUserById(id: string): DbUser | null {
  const stmt = db.prepare("SELECT id, username, display_name, created_at, last_seen FROM users WHERE id = ?");
  const row = stmt.get(id) as {
    id: string;
    username: string;
    display_name: string;
    created_at: number;
    last_seen: number;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

export function getUserByUsername(username: string): DbUser | null {
  const cleanUsername = username.trim().toLowerCase();
  const stmt = db.prepare("SELECT id, username, display_name, created_at, last_seen FROM users WHERE username = ?");
  const row = stmt.get(cleanUsername) as {
    id: string;
    username: string;
    display_name: string;
    created_at: number;
    last_seen: number;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

export function searchUsers(query: string, currentUserId: string): DbUser[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];

  const stmt = db.prepare(`
    SELECT id, username, display_name, created_at, last_seen
    FROM users
    WHERE (username LIKE ? OR display_name LIKE ?) AND id != ?
    LIMIT 20
  `);
  const pattern = `%${clean}%`;
  const rows = stmt.all(pattern, pattern, currentUserId) as Array<{
    id: string;
    username: string;
    display_name: string;
    created_at: number;
    last_seen: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    createdAt: r.created_at,
    lastSeen: r.last_seen,
  }));
}

export function updateLastSeen(userId: string) {
  db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(Date.now(), userId);
}

// Session management
export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

  db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, userId, now, expiresAt);

  return token;
}

export function getSessionUser(token: string): DbUser | null {
  const now = Date.now();
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.created_at, u.last_seen
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
  `);

  const row = stmt.get(token, now) as {
    id: string;
    username: string;
    display_name: string;
    created_at: number;
    last_seen: number;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

export function deleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// Friend management
export function sendFriendRequest(fromUserId: string, toUsername: string): { request: FriendRequest; autoAccepted?: boolean } {
  const toUser = getUserByUsername(toUsername);
  if (!toUser) {
    throw new Error("User not found");
  }
  if (toUser.id === fromUserId) {
    throw new Error("You cannot add yourself as a friend");
  }

  // Check if already friends
  const alreadyFriends = db.prepare(`
    SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?
  `).get(fromUserId, toUser.id);
  if (alreadyFriends) {
    throw new Error("You are already friends with this user");
  }

  // Check if they already sent us a request: auto-accept!
  const reciprocal = db.prepare(`
    SELECT id FROM friend_requests
    WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
  `).get(toUser.id, fromUserId) as { id: string } | undefined;

  const now = Date.now();

  if (reciprocal) {
    db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(reciprocal.id);
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").run(fromUserId, toUser.id, now);
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").run(toUser.id, fromUserId, now);

    const fromUser = getUserById(fromUserId);
    return {
      autoAccepted: true,
      request: {
        id: reciprocal.id,
        fromUserId,
        toUserId: toUser.id,
        fromUsername: fromUser?.username ?? "",
        fromDisplayName: fromUser?.displayName ?? "",
        status: "accepted",
        createdAt: now,
      },
    };
  }

  // Check if request already pending
  const existing = db.prepare(`
    SELECT id FROM friend_requests
    WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
  `).get(fromUserId, toUser.id);
  if (existing) {
    throw new Error("Friend request already sent");
  }

  const requestId = randomBytes(12).toString("hex");
  db.prepare(`
    INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(requestId, fromUserId, toUser.id, now);

  const fromUser = getUserById(fromUserId);
  return {
    request: {
      id: requestId,
      fromUserId,
      toUserId: toUser.id,
      fromUsername: fromUser?.username ?? "",
      fromDisplayName: fromUser?.displayName ?? "",
      status: "pending",
      createdAt: now,
    },
  };
}

export function getPendingFriendRequests(userId: string): FriendRequest[] {
  const stmt = db.prepare(`
    SELECT fr.id, fr.from_user_id, fr.to_user_id, fr.status, fr.created_at,
           u.username as from_username, u.display_name as from_display_name
    FROM friend_requests fr
    JOIN users u ON fr.from_user_id = u.id
    WHERE fr.to_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `);

  const rows = stmt.all(userId) as Array<{
    id: string;
    from_user_id: string;
    to_user_id: string;
    status: "pending" | "accepted" | "declined";
    created_at: number;
    from_username: string;
    from_display_name: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    fromUsername: r.from_username,
    fromDisplayName: r.from_display_name,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export function respondToFriendRequest(requestId: string, currentUserId: string, accept: boolean) {
  const req = db.prepare(`
    SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'
  `).get(requestId, currentUserId) as {
    id: string;
    from_user_id: string;
    to_user_id: string;
    status: string;
  } | undefined;

  if (!req) {
    throw new Error("Friend request not found");
  }

  const status = accept ? "accepted" : "declined";
  db.prepare("UPDATE friend_requests SET status = ? WHERE id = ?").run(status, requestId);

  if (accept) {
    const now = Date.now();
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").run(
      req.from_user_id,
      req.to_user_id,
      now,
    );
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").run(
      req.to_user_id,
      req.from_user_id,
      now,
    );
  }

  return { success: true, fromUserId: req.from_user_id };
}

export function getFriends(userId: string): Array<{
  id: string;
  username: string;
  displayName: string;
  friendSince: number;
  lastSeen: number;
}> {
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.last_seen, f.created_at as friend_since
    FROM friendships f
    JOIN users u ON f.friend_id = u.id
    WHERE f.user_id = ?
    ORDER BY u.display_name ASC
  `);

  const rows = stmt.all(userId) as Array<{
    id: string;
    username: string;
    display_name: string;
    last_seen: number;
    friend_since: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    friendSince: r.friend_since,
    lastSeen: r.last_seen,
  }));
}

export function removeFriend(userId: string, friendId: string) {
  db.prepare("DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").run(
    userId,
    friendId,
    friendId,
    userId,
  );
}

// Call recording
export function recordCallStart(callerId: string, receiverId: string): string {
  const id = randomBytes(12).toString("hex");
  const now = Date.now();
  db.prepare(`
    INSERT INTO calls (id, caller_id, receiver_id, status, started_at)
    VALUES (?, ?, ?, 'ringing', ?)
  `).run(id, callerId, receiverId, now);
  return id;
}

export function recordCallStatus(
  callId: string,
  status: "ringing" | "accepted" | "declined" | "missed" | "ended",
  durationSec?: number,
) {
  const now = Date.now();
  if (status === "ended") {
    db.prepare(`
      UPDATE calls
      SET status = ?, ended_at = ?, duration_sec = ?
      WHERE id = ?
    `).run(status, now, durationSec ?? 0, callId);
  } else {
    db.prepare("UPDATE calls SET status = ? WHERE id = ?").run(status, callId);
  }
}

export function getCallHistory(userId: string, limit = 50): CallRecord[] {
  const stmt = db.prepare(`
    SELECT c.id, c.caller_id, c.receiver_id, c.status, c.started_at, c.ended_at, c.duration_sec,
           caller.username as caller_username, caller.display_name as caller_display_name,
           recv.username as receiver_username, recv.display_name as receiver_display_name
    FROM calls c
    JOIN users caller ON c.caller_id = caller.id
    JOIN users recv ON c.receiver_id = recv.id
    WHERE c.caller_id = ? OR c.receiver_id = ?
    ORDER BY c.started_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(userId, userId, limit) as Array<{
    id: string;
    caller_id: string;
    receiver_id: string;
    status: "ringing" | "accepted" | "declined" | "missed" | "ended";
    started_at: number;
    ended_at: number | null;
    duration_sec: number | null;
    caller_username: string;
    caller_display_name: string;
    receiver_username: string;
    receiver_display_name: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    callerId: r.caller_id,
    receiverId: r.receiver_id,
    callerUsername: r.caller_username,
    callerDisplayName: r.caller_display_name,
    receiverUsername: r.receiver_username,
    receiverDisplayName: r.receiver_display_name,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSec: r.duration_sec,
  }));
}
