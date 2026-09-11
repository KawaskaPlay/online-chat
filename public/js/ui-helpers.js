// Экранируем текст перед вставкой в innerHTML, чтобы сообщение вида
// "<script>..." не выполнялось, а показывалось как обычный текст.
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function toDate(value) {
  if (!value) return null;
  return typeof value.toDate === "function" ? value.toDate() : value;
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

export function renderAvatar(username, avatarUrl, size = 40) {
  const safeName = username || "?";
  if (avatarUrl) {
    return `<img class="avatar" src="${avatarUrl}" alt="${escapeHtml(safeName)}" style="width:${size}px;height:${size}px;">`;
  }
  const initial = safeName.trim().charAt(0).toUpperCase() || "?";
  const bg = colorForName(safeName);
  return `<div class="avatar avatar-fallback" style="width:${size}px;height:${size}px;line-height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${bg};">${initial}</div>`;
}
