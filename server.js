// server.js
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const COOKIE_NAME = process.env.COOKIE_NAME || "wb_token";
const JWT_EXPIRES_DAYS = Number(process.env.JWT_EXPIRES_DAYS || 7);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 8);

// ---------- In-memory stores (simple for dev) ----------
const usersByEmail = new Map(); // email -> { id, email, displayName, passwordHash }
const usersById = new Map(); // id -> user
const boards = new Map(); // boardId -> { shapes: [] }
function getBoard(boardId) {
  if (!boards.has(boardId)) boards.set(boardId, { shapes: [] });
  return boards.get(boardId);
}

// ---------- Auth helpers ----------
function signJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${JWT_EXPIRES_DAYS}d` });
}
function authRequired(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "auth_required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

// ---------- Auth routes ----------
app.post("/api/auth/signup", async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "missing_fields" });
  if (usersByEmail.has(email))
    return res.status(409).json({ error: "email_exists" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    email,
    displayName: displayName || null,
    passwordHash,
  };
  usersByEmail.set(email, user);
  usersById.set(user.id, user);

  const token = signJwt({
    uid: user.id,
    email: user.email,
    name: user.displayName,
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: JWT_EXPIRES_DAYS * 24 * 3600 * 1000,
  });
  res.json({
    ok: true,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = usersByEmail.get(email);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const token = signJwt({
    uid: user.id,
    email: user.email,
    name: user.displayName,
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: JWT_EXPIRES_DAYS * 24 * 3600 * 1000,
  });
  res.json({
    ok: true,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
  });
  res.json({ ok: true });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

// ---------- Boards (simple) ----------
app.get("/new", (req, res) => res.redirect(`/?board=${nanoid()}`));

app.get("/api/boards/:id", authRequired, (req, res) => {
  const boardId = req.params.id || "default";
  const state = getBoard(boardId);
  res.json({ boardId, shapes: state.shapes });
});

// ---------- Socket.IO (auth gate) ----------
io.use((socket, next) => {
  try {
    const cookie = socket.handshake.headers.cookie || "";
    const token = (
      cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${COOKIE_NAME}=`)) || ""
    ).split("=")[1];
    if (!token) return next(new Error("auth_required"));
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error("invalid_token"));
  }
});

io.on("connection", (socket) => {
  let roomId = null;

  socket.on("join", ({ board, user }) => {
    roomId = board || "default";
    socket.join(roomId);

    // hydrate just this client
    const state = getBoard(roomId);
    socket.emit("wb:syncState", state.shapes);

    socket
      .to(roomId)
      .emit("presence:join", {
        id: socket.id,
        user: { ...user, name: socket.user?.name || "User" },
      });
  });

  const relay = (event) => (payload) => {
    if (!roomId) return;
    const state = getBoard(roomId);

    if (event === "wb:add") {
      if (payload?.bulk && Array.isArray(payload.shapes))
        state.shapes.push(...payload.shapes);
      else state.shapes.push(payload);
    }
    if (event === "wb:delete") {
      const ids = payload?.ids || [];
      if (ids.length)
        state.shapes = state.shapes.filter((s) => !ids.includes(s.id));
    }
    if (
      event === "wb:update" &&
      payload?.bulk &&
      Array.isArray(payload.shapes)
    ) {
      // naive replace by id
      const incoming = new Map(payload.shapes.map((s) => [s.id, s]));
      state.shapes = state.shapes.map((s) => incoming.get(s.id) || s);
    }
    // broadcast to others
    socket.to(roomId).emit(event, payload);
  };

  [
    "wb:add",
    "wb:update",
    "wb:delete",
    "wb:clear",
    "wb:undo",
    "wb:redo",
    "wb:cursor",
    "wb:viewport",
    "wb:syncState",
  ].forEach((evt) => socket.on(evt, relay(evt)));

  socket.on("disconnect", () => {
    if (roomId) socket.to(roomId).emit("presence:leave", { id: socket.id });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Auth-enabled Whiteboard → http://localhost:${PORT}`);
  console.log(`Create a new board   → http://localhost:${PORT}/new`);
});
