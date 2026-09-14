import { call, getSocket } from "./realtime.js";

// Живые сообщения чата. Раньше — onSnapshot Firestore, теперь — сначала
// загружаем историю через "get-messages", потом дозаписываем новые
// сообщения по мере прихода события "new-message" (сервер шлёт его через
// Redis Pub/Sub всем, кто "в комнате" этого чата — см. join-chat ниже).
export function watchMessages(chatId, callback) {
  const socket = getSocket();
  let messages = [];

  async function loadAndJoin() {
    try {
      // join-chat заодно проверяет на сервере, что вы участник этого чата —
      // без этого сервер просто не пришлёт вам его сообщения.
      await call("join-chat", { chatId });
      const res = await call("get-messages", { chatId });
      messages = res.messages;
      callback(messages);
    } catch (err) {
      console.error("Не удалось загрузить сообщения:", err.message);
    }
  }

  function onNewMessage({ chatId: eventChatId, message }) {
    if (eventChatId !== chatId) return;
    if (messages.some((m) => m.id === message.id)) return; // на всякий случай, от дублей
    messages = [...messages, message];
    callback(messages);
  }

  socket.on("new-message", onNewMessage);
  // После восстановления соединения переприсоединяемся к комнате чата и
  // подгружаем историю заново — вдруг что-то пропустили, пока связи не было.
  socket.on("connect", loadAndJoin);
  loadAndJoin();

  return () => {
    socket.off("new-message", onNewMessage);
    socket.off("connect", loadAndJoin);
  };
}

// replyTo (необязательно) — { messageId, senderId, text } сообщения, на
// которое отвечаем.
export async function sendTextMessage(chatId, text, replyTo = null) {
  const trimmed = text.trim();
  if (!trimmed) return;
  await call("send-message", { chatId, text: trimmed, replyTo: replyTo || null });
}
