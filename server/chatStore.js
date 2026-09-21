// Вся логика чатов поверх Redis: профили, поиск людей, чаты, сообщения.
// Раньше это жило в Firestore (public/js/chats.js, messages.js) с правилами
// доступа (firestore.rules). Теперь правила доступа — это просто код здесь:
// сервер сам решает, что можно, а что нет, и никакой отдельный файл правил
// не нужен.

const crypto = require("crypto");
const { redis } = require("./redis");

// Один канал Pub/Sub на всё приложение — событие само говорит, что в нём
// (новое сообщение / обновление чата) и кого касается. Для учебного проекта
// это проще, чем заводить отдельный канал на каждый чат, а суть — "Redis как
// шина между всеми серверными процессами" — та же самая.
const PUBSUB_CHANNEL = "chat-events";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const USERNAMES_INDEX = "usernames_index"; // ZSET, score всегда 0 — нужен для ZRANGEBYLEX (поиск по началу имени) и ZRANGE (весь список)

// Реальной загрузки фото в проекте нет (см. README — платный план Blaze
// нужен не будет), поэтому "аватарка" — это цветной кружок с буквой имени
// или, по желанию пользователя, с эмодзи вместо буквы. Оба значения
// приходят от клиента (update-avatar-style), поэтому здесь — тот же
// принцип, что и с avatarUrl раньше: сервер валидирует по фиксированному
// списку и не доверяет клиенту произвольную строку, которая потом попадёт
// в HTML (background: ..., emoji-глиф). Палитра цветов должна совпадать со
// списком в public/js/ui-helpers.js (AVATAR_COLORS), а список эмодзи — с
// public/js/emoji.js (EMOJI_LIST); дублируем их здесь, а не импортируем,
// потому что сервер — CommonJS, а клиентские модули — ES-модули.
const AVATAR_COLORS = ["#e07a5f", "#3d5a80", "#81b29a", "#f2cc8f", "#9b5de5", "#00bbf9", "#f15bb5", "#588157"];
const AVATAR_EMOJI = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😜", "🤔", "🙂",
  "😴", "😭", "😡", "🥳", "😱", "😇", "🤗", "🙄", "😅", "🤯",
  "👍", "👎", "👏", "🙏", "💪", "🤝", "👋", "✌️",
  "❤️", "💔", "🔥", "✨", "⭐", "🎉", "🎂", "☕", "🍕", "⚽",
  "🚀", "💡", "✅", "❌", "☀️", "🌧️", "🐱", "🐶",
];

function usernameKey(usernameLower) {
  return `username:${usernameLower}`;
}
function userKey(uid) {
  return `user:${uid}`;
}
function chatKey(chatId) {
  return `chat:${chatId}`;
}
function chatMessagesKey(chatId) {
  return `chat:${chatId}:messages`;
}
function userChatsKey(uid) {
  return `user:${uid}:chats`;
}

function dmChatId(uidA, uidB) {
  return "dm_" + [uidA, uidB].sort().join("_");
}

// ---------- Профили и поиск людей ----------

async function isUsernameTaken(usernameLower) {
  return (await redis.exists(usernameKey(usernameLower))) === 1;
}

// SET ... NX — атомарная попытка "застолбить" имя: если кто-то другой успел
// на долю секунды раньше, вторая попытка просто не пройдёт. Раньше для этого
// в Firestore был специальный трюк в правилах (allow create, но не update) —
// на Redis то же самое получается одной командой.
async function registerProfile(uid, username) {
  const usernameLower = String(username || "").trim().toLowerCase();
  if (!USERNAME_RE.test(usernameLower)) {
    throw new Error("Имя пользователя: 3-20 символов, латинские буквы, цифры и _");
  }
  const claimed = await redis.set(usernameKey(usernameLower), uid, "NX");
  if (claimed !== "OK") {
    throw new Error("taken");
  }
  await redis.hset(userKey(uid), { username: usernameLower, avatarUrl: "", avatarColor: "", avatarEmoji: "" });
  await redis.zadd(USERNAMES_INDEX, 0, usernameLower);
  return { uid, username: usernameLower, avatarUrl: null, avatarColor: null, avatarEmoji: null };
}

async function getProfile(uid) {
  if (!uid) return null;
  const data = await redis.hgetall(userKey(uid));
  if (!data || !data.username) return null;
  return {
    uid,
    username: data.username,
    avatarUrl: data.avatarUrl || null,
    avatarColor: data.avatarColor || null,
    avatarEmoji: data.avatarEmoji || null,
  };
}

// Пользователь выбирает цвет заглушки и/или эмодзи вместо буквы имени —
// оба поля необязательны и независимы (можно задать только цвет, только
// эмодзи, оба сразу или сбросить обратно на "по умолчанию" пустой
// строкой/null). И то, и другое проверяется по фиксированному списку:
// это не url и не произвольный текст, поэтому "как в аватарке" тут в
// принципе невозможно ничего внедрить, но лучше отклонить на входе, чем
// полагаться только на экранирование при отрисовке.
async function updateAvatarStyle(uid, { color, emoji } = {}) {
  const patch = {};
  if (color !== undefined) {
    if (color && !AVATAR_COLORS.includes(color)) {
      throw new Error("Недопустимый цвет аватарки");
    }
    patch.avatarColor = color || "";
  }
  if (emoji !== undefined) {
    if (emoji && !AVATAR_EMOJI.includes(emoji)) {
      throw new Error("Недопустимый эмодзи для аватарки");
    }
    patch.avatarEmoji = emoji || "";
  }
  if (Object.keys(patch).length > 0) {
    await redis.hset(userKey(uid), patch);
  }
  return getProfile(uid);
}

// Для аккаунтов Firebase Authentication, созданных ещё до переезда чата на
// Redis (когда профиль хранился в Firestore): вход через Firebase проходит
// нормально, а профиля в Redis для такого uid никогда не было. Вместо того
// чтобы заставлять человека регистрироваться заново — досоздаём профиль при
// входе, если его ещё нет. Если уже есть — просто возвращаем как есть.
async function ensureProfile(uid, usernameHint) {
  const existing = await getProfile(uid);
  if (existing) return existing;
  return registerProfile(uid, usernameHint);
}

async function resolveUsers(usernames, excludeSet) {
  if (usernames.length === 0) return [];
  const uids = await redis.mget(usernames.map(usernameKey));
  const result = [];
  usernames.forEach((username, i) => {
    const uid = uids[i];
    if (uid && !excludeSet.has(uid)) result.push({ username, uid });
  });
  return result;
}

// Список пользователей без фильтра — для показа сразу при открытии модалки
// выбора, без необходимости печатать ник.
async function listUsers(excludeUids, limitN = 50) {
  const exclude = new Set(excludeUids || []);
  const usernames = await redis.zrange(USERNAMES_INDEX, 0, limitN - 1);
  return resolveUsers(usernames, exclude);
}

// Поиск по началу имени: ZRANGEBYLEX работает лексикографически, когда у
// всех элементов ZSET одинаковый score (тут всегда 0) — стандартный приём
// Redis для префиксного поиска по строкам.
async function searchUsers(prefix, excludeUids) {
  const prefixLower = String(prefix || "").trim().toLowerCase();
  if (!prefixLower) return listUsers(excludeUids);
  const exclude = new Set(excludeUids || []);
  const usernames = await redis.zrangebylex(
    USERNAMES_INDEX,
    `[${prefixLower}`,
    `[${prefixLower}\xff`,
    "LIMIT",
    0,
    10
  );
  return resolveUsers(usernames, exclude);
}

// ---------- Чаты ----------

function parseChatHash(chatId, raw) {
  if (!raw || !raw.type) return null;
  return {
    id: chatId,
    type: raw.type,
    name: raw.name || null,
    avatarUrl: raw.avatarUrl || null,
    memberIds: JSON.parse(raw.memberIds || "[]"),
    createdAt: Number(raw.createdAt) || null,
    createdBy: raw.createdBy || null,
    lastMessage: raw.lastMessage ? JSON.parse(raw.lastMessage) : null,
  };
}

async function getChat(chatId) {
  if (!chatId) return null;
  const raw = await redis.hgetall(chatKey(chatId));
  return parseChatHash(chatId, raw);
}

async function isMember(chatId, uid) {
  const chat = await getChat(chatId);
  return !!chat && chat.memberIds.includes(uid);
}

// Личный чат с конкретным человеком всегда имеет один и тот же ID
// (составленный из двух uid), поэтому повторный вызов не создаёт дубликат —
// просто возвращает уже существующий.
async function getOrCreateDirectChat(myUid, otherUid) {
  if (!otherUid || typeof otherUid !== "string" || otherUid === myUid) {
    throw new Error("Некорректный собеседник");
  }
  const chatId = dmChatId(myUid, otherUid);
  const exists = (await redis.exists(chatKey(chatId))) === 1;
  if (!exists) {
    const now = Date.now();
    await redis.hset(chatKey(chatId), {
      type: "direct",
      memberIds: JSON.stringify([myUid, otherUid]),
      createdAt: String(now),
      createdBy: myUid,
      lastMessage: "",
    });
    await redis.zadd(userChatsKey(myUid), now, chatId);
    await redis.zadd(userChatsKey(otherUid), now, chatId);
    await publishChatUpdated(chatId, [myUid, otherUid]);
  }
  return chatId;
}

// Тот же фильтр, что и на клиенте (ui-helpers.js safeImageUrl) — сервер не
// должен доверять клиенту и обязан сам отвергать javascript:/data: URI и
// т.п. до того, как значение попадёт в Redis и будет разослано остальным
// участникам чата.
function safeImageUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

async function createGroupChat(myUid, { name, memberUids, avatarUrl } = {}) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("Введите название группы");
  if (!Array.isArray(memberUids) || memberUids.length === 0) {
    throw new Error("Добавьте хотя бы одного участника");
  }
  const allMembers = Array.from(new Set([myUid, ...memberUids]));
  const chatId = "group_" + crypto.randomUUID();
  const now = Date.now();
  await redis.hset(chatKey(chatId), {
    type: "group",
    name: trimmedName,
    avatarUrl: safeImageUrl(avatarUrl),
    memberIds: JSON.stringify(allMembers),
    createdAt: String(now),
    createdBy: myUid,
    lastMessage: "",
  });
  await Promise.all(allMembers.map((uid) => redis.zadd(userChatsKey(uid), now, chatId)));
  await publishChatUpdated(chatId, allMembers);
  return chatId;
}

// Список чатов пользователя, отсортированный по времени последней активности
// (ZSET хранит chatId с score = момент последнего сообщения/создания, поэтому
// сортировка — это просто ZREVRANGE, без отдельного индекса).
async function listMyChats(uid) {
  const chatIds = await redis.zrevrange(userChatsKey(uid), 0, -1);
  const chats = await Promise.all(chatIds.map((id) => getChat(id)));
  return chats.filter(Boolean);
}

// ---------- Сообщения ----------

async function getMessages(chatId) {
  const raw = await redis.lrange(chatMessagesKey(chatId), 0, -1);
  return raw.map((s) => JSON.parse(s));
}

// Раньше текст сообщения ничем не ограничивался по длине: клиент мог
// прислать сообщение на несколько мегабайт, и оно целиком уходило в Redis
// (LIST чата) и рассылалось всем участникам через Pub/Sub — дешёвый способ
// раздуть память Redis и забить канал другим пользователям.
const MAX_MESSAGE_LENGTH = 4000;

// replyTo раньше принимался от клиента как есть — { messageId, senderId,
// text } целиком клиентские данные. Ничто не мешало отправить чужому
// пользователю сообщение с якобы "цитатой" любого другого участника чата с
// произвольным текстом, которого тот никогда не писал (message spoofing):
// escapeHtml() на клиенте не даёт вставить HTML, но не мешает подделать
// сам факт и содержание цитаты. Теперь сервер сам находит исходное
// сообщение по messageId в истории чата и берёт senderId/text из него —
// клиентские senderId/text в replyTo просто игнорируются.
async function resolveReplyTo(chatId, replyTo) {
  const messageId = replyTo?.messageId;
  if (!messageId) return null;
  const raw = await redis.lrange(chatMessagesKey(chatId), 0, -1);
  for (const item of raw) {
    const original = JSON.parse(item);
    if (original.id === messageId) {
      return { messageId, senderId: original.senderId, text: original.text || "" };
    }
  }
  // Сообщение не нашлось (например, уже вытеснено лимитом в 200 штук) —
  // не выдумываем цитату из клиентских данных, просто не показываем её.
  return null;
}

async function sendMessage(chatId, senderId, { text, replyTo } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Пустое сообщение");
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Сообщение слишком длинное (максимум ${MAX_MESSAGE_LENGTH} символов)`);
  }

  const safeReplyTo = await resolveReplyTo(chatId, replyTo);

  const message = {
    id: crypto.randomUUID(),
    type: "text",
    text: trimmed,
    senderId,
    createdAt: Date.now(),
    replyTo: safeReplyTo,
  };

  await redis.rpush(chatMessagesKey(chatId), JSON.stringify(message));
  // Как и раньше в Firestore — храним только последние 200 сообщений чата.
  await redis.ltrim(chatMessagesKey(chatId), -200, -1);

  const chat = await getChat(chatId);
  const preview = { text: trimmed, senderId, createdAt: message.createdAt };
  await redis.hset(chatKey(chatId), "lastMessage", JSON.stringify(preview));
  await Promise.all(
    chat.memberIds.map((uid) => redis.zadd(userChatsKey(uid), message.createdAt, chatId))
  );

  await publish({ kind: "message", chatId, message });
  await publishChatUpdated(chatId, chat.memberIds, { ...chat, lastMessage: preview });

  return message;
}

// ---------- Pub/Sub ----------

async function publishChatUpdated(chatId, memberIds, chatOverride) {
  const chat = chatOverride || (await getChat(chatId));
  await publish({ kind: "chat-updated", chatId, memberIds, chat });
}

async function publish(payload) {
  await redis.publish(PUBSUB_CHANNEL, JSON.stringify(payload));
}

module.exports = {
  PUBSUB_CHANNEL,
  isUsernameTaken,
  registerProfile,
  getProfile,
  ensureProfile,
  updateAvatarStyle,
  listUsers,
  searchUsers,
  getOrCreateDirectChat,
  createGroupChat,
  getChat,
  isMember,
  listMyChats,
  getMessages,
  sendMessage,
};
