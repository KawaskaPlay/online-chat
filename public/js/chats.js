import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDoc, setDoc, addDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Поиск пользователей по началу имени. Работает через коллекцию
// usernames/{username}, которая заодно служит и индексом поиска
// (Firestore умеет диапазонные запросы по ID документа).
export async function searchUsers(prefix, excludeUid) {
  const prefixLower = prefix.trim().toLowerCase();
  if (!prefixLower) return [];

  const usernamesRef = collection(db, "usernames");
  const q = query(
    usernamesRef,
    orderBy("__name__"),
    where("__name__", ">=", prefixLower),
    where("__name__", "<=", prefixLower + ""),
    limit(10)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ username: d.id, uid: d.data().uid }))
    .filter((u) => u.uid !== excludeUid);
}

function dmChatId(uidA, uidB) {
  return "dm_" + [uidA, uidB].sort().join("_");
}

// Личный чат с конкретным человеком всегда имеет один и тот же ID
// (составленный из двух uid), поэтому при повторном открытии чат не
// дублируется — мы просто находим уже существующий документ.
export async function getOrCreateDirectChat(otherUid) {
  const myUid = auth.currentUser.uid;
  const chatId = dmChatId(myUid, otherUid);
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    await setDoc(chatRef, {
      type: "direct",
      memberIds: [myUid, otherUid],
      createdAt: serverTimestamp(),
      createdBy: myUid,
      lastMessage: null,
    });
  }
  return chatId;
}

export async function createGroupChat({ name, memberUids, avatarUrl }) {
  const myUid = auth.currentUser.uid;
  const allMembers = Array.from(new Set([myUid, ...memberUids]));
  const docRef = await addDoc(collection(db, "chats"), {
    type: "group",
    name: name.trim(),
    avatarUrl: avatarUrl || null,
    memberIds: allMembers,
    createdAt: serverTimestamp(),
    createdBy: myUid,
    lastMessage: null,
  });
  return docRef.id;
}

// Список чатов текущего пользователя, обновляется в реальном времени.
// Сортируем на клиенте (по времени последнего сообщения), чтобы не
// требовать создания составного индекса в Firebase Console.
export function watchMyChats(callback) {
  const myUid = auth.currentUser.uid;
  const q = query(collection(db, "chats"), where("memberIds", "array-contains", myUid));
  return onSnapshot(q, (snap) => {
    const chats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    chats.sort((a, b) => {
      const ta = a.lastMessage?.createdAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
      const tb = b.lastMessage?.createdAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
    callback(chats);
  });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}
