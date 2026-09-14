import { call, getSocket } from "./realtime.js";

// excludeUids может быть одним uid или массивом uid — удобно и для
// "исключить только себя" (личный чат), и для "исключить себя + уже
// выбранных" (группа).
function normalizeExclude(excludeUids) {
  if (!excludeUids) return [];
  return Array.isArray(excludeUids) ? excludeUids : [excludeUids];
}

// Список пользователей без фильтра по имени — чтобы показывать сразу при
// открытии модалки выбора, не заставляя вводить ник вручную.
export async function listUsers(excludeUids, limitN = 50) {
  const res = await call("list-users", { excludeUids: normalizeExclude(excludeUids), limit: limitN });
  return res.users;
}

// Поиск пользователей по началу имени.
export async function searchUsers(prefix, excludeUids) {
  const res = await call("search-users", { prefix, excludeUids: normalizeExclude(excludeUids) });
  return res.users;
}

export async function getOrCreateDirectChat(otherUid) {
  const res = await call("get-or-create-direct-chat", { otherUid });
  return res.chatId;
}

export async function createGroupChat({ name, memberUids, avatarUrl }) {
  const res = await call("create-group-chat", { name, memberUids, avatarUrl });
  return res.chatId;
}

// Список чатов текущего пользователя, обновляется в реальном времени.
// Раньше это был onSnapshot Firestore, теперь — события "chat-updated" по
// WebSocket, которые сервер рассылает через Redis Pub/Sub. Сортируем на
// клиенте (по времени последнего сообщения), как и раньше.
export function watchMyChats(callback) {
  const socket = getSocket();
  let chatsById = new Map();

  function emit() {
    const chats = Array.from(chatsById.values());
    chats.sort((a, b) => {
      const ta = a.lastMessage?.createdAt ?? a.createdAt ?? 0;
      const tb = b.lastMessage?.createdAt ?? b.createdAt ?? 0;
      return tb - ta;
    });
    callback(chats);
  }

  async function refresh() {
    try {
      const res = await call("list-chats");
      chatsById = new Map(res.chats.map((c) => [c.id, c]));
      emit();
    } catch (err) {
      console.error("Не удалось загрузить чаты:", err.message);
    }
  }

  function onChatUpdated({ chat }) {
    chatsById.set(chat.id, chat);
    emit();
  }

  socket.on("chat-updated", onChatUpdated);
  // "connect" сработает и сейчас (если сокет ещё не был подключён), и после
  // каждого восстановления соединения — так список не "зависает", если на
  // секунду пропал интернет.
  socket.on("connect", refresh);
  refresh();

  return () => {
    socket.off("chat-updated", onChatUpdated);
    socket.off("connect", refresh);
  };
}

export async function getUserProfile(uid) {
  const res = await call("get-profile", { uid });
  return res.profile;
}
