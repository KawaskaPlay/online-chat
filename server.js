const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const { redisSub } = require("./server/redis");
const chatStore = require("./server/chatStore");
const { verifyFirebaseIdToken } = require("./server/firebaseToken");

const app = express();
const PORT = process.env.PORT || 3000;

// Аккаунты, чаты, сообщения — всё в Firebase Auth (вход/регистрация) и Redis
// (всё остальное). Сервер тут раздаёт статику И держит WebSocket-соединения.
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const httpServer = http.createServer(app);
// Сокет живёт на том же сервере/порту, что и сайт — отдельный CORS не нужен.
const io = new Server(httpServer);

// ---------- Аутентификация сокета ----------
// Firebase Auth выдаёт клиенту ID-токен ("кто ты"), дальше каждое сокет-
// соединение само подтверждает личность этим токеном при подключении.
// Часть событий (поиск людей, проверка имени при регистрации) разрешена и
// без токена — это открытые данные, как раньше "allow read: if true" в
// Firestore. Остальные события сами проверяют socket.data.uid и отказывают,
// если пользователь не подтверждён.
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const { uid } = await verifyFirebaseIdToken(token);
      socket.data.uid = uid;
    } catch (err) {
      console.warn("[socket] недействительный токен:", err.message);
      // Не рвём соединение — просто остаётся анонимным.
    }
  }
  next();
});

function requireUid(socket) {
  if (!socket.data.uid) throw new Error("Нужно войти в систему");
  return socket.data.uid;
}

// ---------- Rate limiting для send-message ----------
// Раньше ничего не мешало одному клиенту слать сообщения в цикле без пауз
// (скриптом, а не руками) — это и спам собеседникам, и лишняя нагрузка на
// Redis/Pub/Sub. Простое ограничение по скользящему окну на пользователя:
// не больше MAX_MESSAGES_PER_WINDOW сообщений за WINDOW_MS. Для учебного
// проекта с одним процессом сервера достаточно хранить счётчики в памяти —
// не нужен отдельный Redis-механизм (это же ограничение, ключ к которому и
// так живёт на сервере, а не что-то, что должно переживать перезапуск).
const RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 20;
const messageTimestamps = new Map(); // uid -> [timestamps]

function checkMessageRateLimit(uid) {
  const now = Date.now();
  const timestamps = (messageTimestamps.get(uid) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= MAX_MESSAGES_PER_WINDOW) {
    throw new Error("Слишком много сообщений подряд, подождите немного");
  }
  timestamps.push(now);
  messageTimestamps.set(uid, timestamps);
}

io.on("connection", (socket) => {
  // Личная "комната" пользователя — сюда сервер шлёт события вроде "у тебя
  // новый чат" или "обновился чат", даже если клиент ещё не открыл его.
  if (socket.data.uid) {
    socket.join(`user:${socket.data.uid}`);
  }

  socket.on("check-username", async (payload, ack) => {
    try {
      const usernameLower = String(payload?.username || "").trim().toLowerCase();
      const taken = usernameLower ? await chatStore.isUsernameTaken(usernameLower) : false;
      ack?.({ ok: true, taken });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("register-profile", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const profile = await chatStore.registerProfile(uid, payload?.username);
      socket.join(`user:${uid}`);
      ack?.({ ok: true, profile });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  // Для аккаунтов, созданных ещё до переезда на Redis (см. auth.js login()):
  // досоздаёт профиль в Redis, если его почему-то ещё нет, вместо того чтобы
  // заставлять человека регистрироваться заново.
  socket.on("ensure-profile", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const profile = await chatStore.ensureProfile(uid, payload?.username);
      ack?.({ ok: true, profile });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  // В отличие от остальных обработчиков ниже, этот раньше не проверял
  // requireUid — любой, даже не прошедший аутентификацию сокет, мог
  // запросить профиль (username, avatarUrl) по произвольному uid. Остальные
  // способы получить профиль (list-users/search-users) уже требуют входа —
  // приводим get-profile к тому же правилу: сначала подтвердите личность.
  // Реальной загрузки фото нет (см. README про план Blaze) — вместо этого
  // пользователь может выбрать цвет кружка-заглушки и/или эмодзи вместо
  // буквы имени. Валидация значений — в chatStore.updateAvatarStyle.
  socket.on("update-avatar-style", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const profile = await chatStore.updateAvatarStyle(uid, payload || {});
      ack?.({ ok: true, profile });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("get-profile", async (payload, ack) => {
    try {
      requireUid(socket);
      const profile = await chatStore.getProfile(payload?.uid);
      ack?.({ ok: true, profile });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("list-users", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const exclude = [uid, ...(payload?.excludeUids || [])];
      const users = await chatStore.listUsers(exclude, payload?.limit);
      ack?.({ ok: true, users });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("search-users", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const exclude = [uid, ...(payload?.excludeUids || [])];
      const users = await chatStore.searchUsers(payload?.prefix, exclude);
      ack?.({ ok: true, users });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("get-or-create-direct-chat", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const chatId = await chatStore.getOrCreateDirectChat(uid, payload?.otherUid);
      ack?.({ ok: true, chatId });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("create-group-chat", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const chatId = await chatStore.createGroupChat(uid, payload || {});
      ack?.({ ok: true, chatId });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("list-chats", async (_payload, ack) => {
    try {
      const uid = requireUid(socket);
      const chats = await chatStore.listMyChats(uid);
      ack?.({ ok: true, chats });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("join-chat", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const chatId = payload?.chatId;
      if (!(await chatStore.isMember(chatId, uid))) throw new Error("Вы не участник этого чата");
      socket.join(`chat:${chatId}`);
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("get-messages", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      const chatId = payload?.chatId;
      if (!(await chatStore.isMember(chatId, uid))) throw new Error("Вы не участник этого чата");
      const messages = await chatStore.getMessages(chatId);
      ack?.({ ok: true, messages });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("send-message", async (payload, ack) => {
    try {
      const uid = requireUid(socket);
      checkMessageRateLimit(uid);
      const chatId = payload?.chatId;
      if (!(await chatStore.isMember(chatId, uid))) throw new Error("Вы не участник этого чата");
      const message = await chatStore.sendMessage(chatId, uid, payload || {});
      ack?.({ ok: true, message });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });
});

// ---------- Redis Pub/Sub -> рассылка всем подключённым через Socket.IO ----------
// sendMessage/getOrCreateDirectChat и т.п. в chatStore.js не рассылают
// события сами — они публикуют их в Redis (redis.publish). Слушаем здесь и
// раскидываем по нужным "комнатам" Socket.IO. Благодаря этому чат мгновенно
// обновляется у всех участников, и если когда-нибудь запустить несколько
// экземпляров сервера (например, при масштабировании на Render) — они все
// подписаны на один и тот же Redis и узнают о сообщениях друг друга, а не
// только клиенты, подключённые к тому же процессу.
redisSub.subscribe(chatStore.PUBSUB_CHANNEL, (err) => {
  if (err) console.error("[redis] не удалось подписаться на канал:", err.message);
});

redisSub.on("message", (_channel, raw) => {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  if (event.kind === "message") {
    io.to(`chat:${event.chatId}`).emit("new-message", {
      chatId: event.chatId,
      message: event.message,
    });
  } else if (event.kind === "chat-updated") {
    for (const uid of event.memberIds || []) {
      io.to(`user:${uid}`).emit("chat-updated", { chat: event.chat });
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
