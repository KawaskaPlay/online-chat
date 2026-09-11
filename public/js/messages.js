import { db, auth } from "./firebase-init.js";
import {
  collection, addDoc, doc, updateDoc, query, orderBy, limit, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export function watchMessages(chatId, callback) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("createdAt", "asc"),
    limit(200)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function sendTextMessage(chatId, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  await addMessage(chatId, { type: "text", text: trimmed });
}

// Отправка фото временно отключена (нужен платный план Blaze для Firebase
// Storage) — см. README -> "Как добавить фото позже", чтобы вернуть.

async function addMessage(chatId, data) {
  const myUid = auth.currentUser.uid;
  const messagesRef = collection(db, "chats", chatId, "messages");
  await addDoc(messagesRef, {
    ...data,
    senderId: myUid,
    createdAt: serverTimestamp(),
  });

  // Обновляем превью последнего сообщения в списке чатов (denormalized-поле,
  // чтобы список чатов не нужно было пересчитывать по всем сообщениям).
  const preview = data.type === "image" ? "📷 Фото" : data.text;
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: { text: preview, senderId: myUid, createdAt: serverTimestamp() },
  });
}
