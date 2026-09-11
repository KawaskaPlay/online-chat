import { auth } from "./firebase-init.js";
import { watchAuthState, logout } from "./auth.js";
import {
  watchMyChats, getOrCreateDirectChat, createGroupChat, searchUsers, listUsers, getUserProfile,
} from "./chats.js";
import { watchMessages, sendTextMessage } from "./messages.js";
import { renderAvatar, escapeHtml, formatTime, formatDay } from "./ui-helpers.js";
import { EMOJI_LIST } from "./emoji.js";

let myProfile = null;
let currentChatId = null;
let unsubscribeMessages = null;
let replyingTo = null; // { messageId, senderId, text } — сообщение, на которое отвечаем, или null
const profileCache = new Map(); // uid -> профиль (кэш, чтобы не дёргать Firestore на каждое сообщение)
const chatsCache = new Map(); // chatId -> данные чата (для шапки/списка)
const messagesById = new Map(); // messageId -> данные сообщения текущего открытого чата (для реплаев)

const appEl = document.getElementById("app");

watchAuthState(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  myProfile = await getUserProfile(user.uid);
  if (!myProfile) {
    // На всякий случай: аккаунт есть, а профиля в Firestore почему-то нет.
    myProfile = { uid: user.uid, username: "пользователь", avatarUrl: null };
  }
  profileCache.set(user.uid, myProfile);
  renderMePanel();
  watchMyChats(renderChatList);
});

function renderMePanel() {
  document.getElementById("me-avatar").innerHTML = renderAvatar(myProfile.username, myProfile.avatarUrl, 36);
  document.getElementById("me-username").textContent = myProfile.username;
}

document.getElementById("logout-btn").addEventListener("click", () => logout());

// ---------- Список чатов ----------

async function renderChatList(chats) {
  const listEl = document.getElementById("chat-list");
  listEl.innerHTML = "";

  for (const chat of chats) {
    chatsCache.set(chat.id, chat);
    const { title, avatarUrl } = await chatDisplayInfo(chat);

    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === currentChatId ? " active" : "");
    item.dataset.chatId = chat.id;
    const preview = chat.lastMessage ? escapeHtml(chat.lastMessage.text) : "Нет сообщений";
    item.innerHTML = `
      ${renderAvatar(title, avatarUrl, 44)}
      <div class="chat-item-info">
        <div class="chat-item-title">${escapeHtml(title)}</div>
        <div class="chat-item-preview">${preview}</div>
      </div>
    `;
    item.addEventListener("click", () => openChat(chat.id));
    listEl.appendChild(item);
  }

  if (chats.length === 0) {
    listEl.innerHTML = `<div class="no-results">Пока нет ни одного чата</div>`;
  }
}

async function chatDisplayInfo(chat) {
  if (chat.type === "group") {
    return { title: chat.name || "Группа", avatarUrl: chat.avatarUrl };
  }
  const otherUid = chat.memberIds.find((id) => id !== auth.currentUser.uid);
  const profile = await getCachedProfile(otherUid);
  return { title: profile?.username || "Пользователь", avatarUrl: profile?.avatarUrl };
}

async function getCachedProfile(uid) {
  if (profileCache.has(uid)) return profileCache.get(uid);
  const profile = await getUserProfile(uid);
  profileCache.set(uid, profile);
  return profile;
}

// ---------- Открытие чата ----------

async function openChat(chatId) {
  currentChatId = chatId;
  cancelReply(); // реплай привязан к конкретному чату — при переключении сбрасываем
  appEl.classList.add("chat-open");
  document.getElementById("chat-empty").classList.add("hidden");
  document.getElementById("chat-view").classList.remove("hidden");

  document.querySelectorAll(".chat-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.chatId === chatId);
  });

  const chat = chatsCache.get(chatId);
  const { title, avatarUrl } = await chatDisplayInfo(chat);
  const memberCount = chat.memberIds.length;
  document.getElementById("chat-header-info").innerHTML = `
    ${renderAvatar(title, avatarUrl, 36)}
    <div>
      <div class="chat-header-title">${escapeHtml(title)}</div>
      ${chat.type === "group" ? `<div class="chat-header-sub">${memberCount} участников</div>` : ""}
    </div>
  `;

  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeMessages = watchMessages(chatId, renderMessages);
}

document.getElementById("back-btn").addEventListener("click", () => {
  appEl.classList.remove("chat-open");
});

async function renderMessages(messages) {
  const container = document.getElementById("messages");
  const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;

  container.innerHTML = "";
  messagesById.clear();
  let lastDay = null;

  for (const msg of messages) {
    messagesById.set(msg.id, msg);
    const profile = await getCachedProfile(msg.senderId);
    const isMine = msg.senderId === auth.currentUser.uid;
    const day = msg.createdAt ? formatDay(msg.createdAt) : null;

    if (day && day !== lastDay) {
      const daySep = document.createElement("div");
      daySep.className = "day-separator";
      daySep.textContent = day;
      container.appendChild(daySep);
      lastDay = day;
    }

    const row = document.createElement("div");
    row.className = "message-row " + (isMine ? "mine" : "theirs");
    row.dataset.messageId = msg.id;

    const bodyHtml = msg.type === "image"
      ? `<a href="${msg.imageUrl}" target="_blank" rel="noopener"><img class="message-image" src="${msg.imageUrl}" alt="фото"></a>`
      : `<div class="message-text">${escapeHtml(msg.text)}</div>`;

    let replyQuoteHtml = "";
    if (msg.replyTo) {
      const replyProfile = await getCachedProfile(msg.replyTo.senderId);
      const replyAuthorName = msg.replyTo.senderId === auth.currentUser.uid
        ? "Вы"
        : (replyProfile?.username || "Пользователь");
      replyQuoteHtml = `
        <div class="message-reply-quote" data-scroll-to="${escapeHtml(msg.replyTo.messageId)}">
          <div class="message-reply-quote-author">${escapeHtml(replyAuthorName)}</div>
          <div class="message-reply-quote-text">${escapeHtml(msg.replyTo.text || "")}</div>
        </div>
      `;
    }

    row.innerHTML = `
      ${isMine ? "" : renderAvatar(profile?.username || "?", profile?.avatarUrl, 32)}
      <div class="message-bubble">
        ${isMine ? "" : `<div class="message-author">${escapeHtml(profile?.username || "?")}</div>`}
        ${replyQuoteHtml}
        ${bodyHtml}
        <div class="message-time">${formatTime(msg.createdAt)}</div>
      </div>
      <button type="button" class="message-reply-btn" title="Ответить">↩</button>
    `;
    container.appendChild(row);
  }

  if (wasAtBottom || messages.length <= 1) {
    container.scrollTop = container.scrollHeight;
  }
}

// ---------- Ответ на сообщение (реплай) ----------

document.getElementById("messages").addEventListener("click", (e) => {
  const replyBtn = e.target.closest(".message-reply-btn");
  if (replyBtn) {
    const row = replyBtn.closest(".message-row");
    if (row) startReply(row.dataset.messageId);
    return;
  }
  const quote = e.target.closest(".message-reply-quote");
  if (quote) {
    const targetRow = document.querySelector(
      `.message-row[data-message-id="${CSS.escape(quote.dataset.scrollTo)}"]`
    );
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
      targetRow.classList.add("highlight");
      setTimeout(() => targetRow.classList.remove("highlight"), 1200);
    }
  }
});

function startReply(messageId) {
  const msg = messagesById.get(messageId);
  if (!msg) return;
  const isMine = msg.senderId === auth.currentUser.uid;
  const authorName = isMine ? "Вы" : (profileCache.get(msg.senderId)?.username || "Пользователь");
  const text = msg.type === "image" ? "📷 Фото" : msg.text;

  replyingTo = { messageId, senderId: msg.senderId, text };
  document.getElementById("reply-preview-author").textContent = authorName;
  document.getElementById("reply-preview-text").textContent = text;
  document.getElementById("reply-preview").classList.remove("hidden");
  document.getElementById("message-input").focus();
}

function cancelReply() {
  replyingTo = null;
  document.getElementById("reply-preview").classList.add("hidden");
}

document.getElementById("reply-preview-cancel").addEventListener("click", cancelReply);

// ---------- Отправка сообщений ----------

document.getElementById("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentChatId) return;
  const input = document.getElementById("message-input");
  const text = input.value;
  const replyPayload = replyingTo ? { ...replyingTo } : null;
  input.value = "";
  cancelReply();
  if (text.trim()) {
    try {
      await sendTextMessage(currentChatId, text, replyPayload);
    } catch (err) {
      alert("Не удалось отправить сообщение: " + err.message);
    }
  }
});

// ---------- Эмодзи ----------

const emojiBtn = document.getElementById("emoji-btn");
const emojiPicker = document.getElementById("emoji-picker");
emojiPicker.innerHTML = EMOJI_LIST.map((e) => `<span class="emoji-option">${e}</span>`).join("");

emojiBtn.addEventListener("click", () => emojiPicker.classList.toggle("hidden"));

emojiPicker.addEventListener("click", (e) => {
  if (!e.target.classList.contains("emoji-option")) return;
  const input = document.getElementById("message-input");
  input.value += e.target.textContent;
  input.focus();
  emojiPicker.classList.add("hidden");
});

document.addEventListener("click", (e) => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.classList.add("hidden");
  }
});

// ---------- Модалка: новый личный чат ----------

const dmModal = document.getElementById("dm-modal");

async function pickDmUser(user) {
  dmModal.classList.add("hidden");
  const chatId = await getOrCreateDirectChat(user.uid);
  openChat(chatId);
}

// Показываем список пользователей сразу при открытии модалки — не нужно
// ничего вводить, можно просто кликнуть по нужному человеку. Поле поиска
// остаётся, чтобы можно было сузить список, если пользователей много.
async function refreshDmResults(filter = "") {
  const results = filter.trim()
    ? await searchUsers(filter, auth.currentUser.uid)
    : await listUsers(auth.currentUser.uid);
  renderUserResults("dm-results", results, pickDmUser);
}

document.getElementById("new-dm-btn").addEventListener("click", () => {
  document.getElementById("dm-search").value = "";
  document.getElementById("dm-results").innerHTML = "";
  dmModal.classList.remove("hidden");
  document.getElementById("dm-search").focus();
  refreshDmResults();
});

document.getElementById("dm-search").addEventListener("input", debounce((e) => {
  refreshDmResults(e.target.value);
}, 300));

// ---------- Модалка: новая группа ----------

const groupModal = document.getElementById("group-modal");
const selectedGroupMembers = new Map(); // uid -> username

// Список исключает и себя, и уже выбранных участников — не нужно листать
// мимо тех, кого уже добавили.
async function refreshGroupResults(filter = "") {
  const excludeUids = [auth.currentUser.uid, ...selectedGroupMembers.keys()];
  const results = filter.trim()
    ? await searchUsers(filter, excludeUids)
    : await listUsers(excludeUids);
  renderUserResults("group-results", results, (user) => {
    selectedGroupMembers.set(user.uid, user.username);
    renderGroupChips();
    document.getElementById("group-search").value = "";
    refreshGroupResults();
  });
}

document.getElementById("new-group-btn").addEventListener("click", () => {
  document.getElementById("group-name").value = "";
  document.getElementById("group-search").value = "";
  selectedGroupMembers.clear();
  renderGroupChips();
  groupModal.classList.remove("hidden");
  refreshGroupResults();
});

document.getElementById("group-search").addEventListener("input", debounce((e) => {
  refreshGroupResults(e.target.value);
}, 300));

function renderGroupChips() {
  const chipsEl = document.getElementById("group-chips");
  chipsEl.innerHTML = "";
  for (const [uid, username] of selectedGroupMembers) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = username + " ✕";
    chip.addEventListener("click", () => {
      selectedGroupMembers.delete(uid);
      renderGroupChips();
      refreshGroupResults(document.getElementById("group-search").value);
    });
    chipsEl.appendChild(chip);
  }
}

document.getElementById("group-create-btn").addEventListener("click", async () => {
  const name = document.getElementById("group-name").value.trim();
  if (!name) {
    alert("Введите название группы");
    return;
  }
  if (selectedGroupMembers.size === 0) {
    alert("Добавьте хотя бы одного участника");
    return;
  }
  const chatId = await createGroupChat({
    name,
    memberUids: Array.from(selectedGroupMembers.keys()),
  });
  groupModal.classList.add("hidden");
  openChat(chatId);
});

// ---------- Общие помощники ----------

function renderUserResults(containerId, users, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  if (users.length === 0) {
    el.innerHTML = `<div class="no-results">Никого не найдено</div>`;
    return;
  }
  for (const user of users) {
    const row = document.createElement("div");
    row.className = "user-result";
    row.innerHTML = `${renderAvatar(user.username, null, 28)} <span>${escapeHtml(user.username)}</span>`;
    row.addEventListener("click", () => onPick(user));
    el.appendChild(row);
  }
}

document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById(btn.dataset.close).classList.add("hidden");
  });
});

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
