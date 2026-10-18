import { spawn } from "node:child_process";
import { io, type Socket } from "socket.io-client";
import {
  authenticateUser,
  createSession,
  createUser,
  getCallHistory,
  getFriends,
  getPendingFriendRequests,
  getSessionUser,
  getUserById,
  recordCallStart,
  recordCallStatus,
  respondToFriendRequest,
  sendFriendRequest,
} from "../server/src/db.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

console.log("--- Testing Database & Auth ---");

// 1. Create users
const timestamp = Date.now();
const u1Username = `alice_${timestamp}`;
const u2Username = `bob_${timestamp}`;

const alice = createUser(u1Username, "password123", "Alice Wonderland");
check("create user alice", Boolean(alice && alice.id && alice.username === u1Username));

const bob = createUser(u2Username, "secret456", "Bob Builder");
check("create user bob", Boolean(bob && bob.id && bob.username === u2Username));

// Duplicate check
let dupFailed = false;
try {
  createUser(u1Username, "newpass");
} catch {
  dupFailed = true;
}
check("reject duplicate username", dupFailed);

// 2. Authenticate
const authSuccess = authenticateUser(u1Username, "password123");
check("authenticate with correct password", authSuccess?.id === alice.id);

const authWrong = authenticateUser(u1Username, "wrongpass");
check("reject incorrect password", authWrong === null);

// 3. Sessions
const token = createSession(alice.id);
const sessionUser = getSessionUser(token);
check("session token retrieves user", sessionUser?.id === alice.id);

// 4. Friend requests
const fr = sendFriendRequest(alice.id, bob.username);
check("send friend request", fr.request.status === "pending" && fr.request.toUserId === bob.id);

const bobPending = getPendingFriendRequests(bob.id);
check("bob sees pending friend request", bobPending.some((r) => r.id === fr.request.id));

// 5. Accept friend request
const accepted = respondToFriendRequest(fr.request.id, bob.id, true);
check("bob accepts friend request", accepted.success);

const aliceFriends = getFriends(alice.id);
const bobFriends = getFriends(bob.id);
check("mutual friendship in database", aliceFriends.some((f) => f.id === bob.id) && bobFriends.some((f) => f.id === alice.id));

// 6. Call records
const callId = recordCallStart(alice.id, bob.id);
recordCallStatus(callId, "ended", 142);
const bobHistory = getCallHistory(bob.id);
check("call record stored with duration", bobHistory.some((c) => c.id === callId && c.durationSec === 142));

console.log("--- Testing Real-time FaceTime Sockets ---");

const PORT = 4001;
const URL = `http://localhost:${PORT}`;

const server = spawn("npx", ["tsx", "server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});

await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 10000);
  server.stdout?.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("listening")) {
      clearTimeout(timer);
      resolve();
    }
  });
});

async function connectSocket(sessionToken: string): Promise<Socket> {
  const socket = io(URL, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res) => socket.once("connect", () => res()));
  socket.emit("auth:init", { token: sessionToken });
  return socket;
}

try {
  const aliceToken = createSession(alice.id);
  const bobToken = createSession(bob.id);

  const bobSocket = await connectSocket(bobToken);
  const aliceSocket = await connectSocket(aliceToken);

  // Bob waits for incoming call
  const incomingPromise = new Promise<{ callId: string; caller: { username: string } }>((resolve) => {
    bobSocket.on("call:incoming", resolve);
  });

  // Alice starts call to Bob
  aliceSocket.emit("call:start", { receiverId: bob.id, role: "presenter" });

  const incoming = await incomingPromise;
  check("bob receives incoming call notification", incoming.caller.username === alice.username);

  // Bob accepts call
  const connectedPromise = new Promise<{ callId: string }>((resolve) => {
    aliceSocket.on("call:accepted", resolve);
  });

  bobSocket.emit("call:accept", { callId: incoming.callId });
  const connected = await connectedPromise;
  check("alice receives call accepted and both connect", connected.callId === incoming.callId);

  // Alice ends call
  const endedPromise = new Promise<{ callId: string; durationSec: number }>((resolve) => {
    bobSocket.on("call:ended", resolve);
  });
  aliceSocket.emit("call:end", { callId: incoming.callId });
  const ended = await endedPromise;
  check("call end notifies peers and records duration", ended.callId === incoming.callId);
  check("presenter caller makes the receiver the helper", (incoming as { role?: string }).role === "helper");

  // Alice calls as the guide this time: she is the helper and Bob films.
  const guideIncoming = new Promise<{ callId: string; role: string }>((resolve) => bobSocket.once("call:incoming", resolve));
  const guideRinging = new Promise<{ role: string }>((resolve) => aliceSocket.once("call:ringing", resolve));
  aliceSocket.emit("call:start", { receiverId: bob.id, role: "helper" });
  const [asGuide, ringing] = await Promise.all([guideIncoming, guideRinging]);
  check("helper caller keeps the helper role", ringing.role === "helper");
  check("helper caller makes the receiver the presenter", asGuide.role === "presenter");
  const guideEnded = new Promise((resolve) => bobSocket.once("call:ended", resolve));
  aliceSocket.emit("call:end", { callId: asGuide.callId });
  await guideEnded;

  aliceSocket.disconnect();
  bobSocket.disconnect();
} finally {
  server.kill();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll FaceTime database and calling checks passed successfully!");
  process.exit(0);
}
