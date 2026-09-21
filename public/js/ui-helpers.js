// Экранируем текст перед вставкой в innerHTML, чтобы сообщение вида
// "<script>..." не выполнялось, а показывалось как обычный текст.
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function toDate(value) {
  if (!value) return null;
  // Firestore Timestamp (на случай, если где-то ещё встретится) — теперь же
  // createdAt приходит с сервера просто числом (мс), как из Redis.
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "number") return new Date(value);
  return value;
}

export function formatTime(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Аватар-заглушка: цветной кружок с первой буквой имени — используется,
// если у пользователя нет своей картинки.
const AVATAR_COLORS = ["#e07a5f", "#3d5a80", "#81b29a", "#f2cc8f", "#9b5de5", "#00bbf9", "#f15bb5", "#588157"];

function colorForName(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Разрешаем только http(s) — так в src="${...}" никогда не попадёт
// javascript:/data: URI или что-то, что ломает атрибут кавычкой.
// Экспортируем: этот же фильтр нужен везде, где URL картинки вставляется
// в HTML-атрибут напрямую (см. app.js — фото в сообщениях).
export function safeImageUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function renderAvatar(username, avatarUrl, size = 40) {
  const safeName = username || "?";
  const safeUrl = safeImageUrl(avatarUrl);
  if (safeUrl) {
    // escapeHtml обязателен и для URL: без него значение могло бы выйти
    // за пределы атрибута src (например через двойную кавычку) и вставить
    // произвольный HTML/обработчик события — это и есть хранимая XSS.
    return `<img class="avatar" src="${escapeHtml(safeUrl)}" alt="${escapeHtml(safeName)}" style="width:${size}px;height:${size}px;">`;
  }
  const initial = safeName.trim().charAt(0).toUpperCase() || "?";
  const bg = colorForName(safeName);
  return `<div class="avatar avatar-fallback" style="width:${size}px;height:${size}px;line-height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${bg};">${initial}</div>`;
}
