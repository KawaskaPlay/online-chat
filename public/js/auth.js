import { auth } from "./firebase-init.js";
import { call, reauth } from "./realtime.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// Firebase Authentication (в режиме email/password) требует email, а не
// username. Поэтому внутри мы превращаем "username" в
// "username@chatapp.local" — обычный пользователь этого не видит.
const FAKE_EMAIL_DOMAIN = "chatapp.local";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username) {
  return USERNAME_RE.test(username.trim());
}

// Проверка "свободно ли имя" теперь идёт через сервер (Redis), а не
// напрямую в базу — но с точки зрения остального кода ничего не изменилось.
export async function isUsernameTaken(username) {
  const res = await call("check-username", { username: normalizeUsername(username) });
  return !!res.taken;
}

export async function register({ username, password }) {
  const usernameLower = normalizeUsername(username);

  if (!isValidUsername(username)) {
    throw new Error("Имя пользователя: 3-20 символов, латинские буквы, цифры и _");
  }
  if (password.length < 6) {
    throw new Error("Пароль должен быть не короче 6 символов");
  }

  const email = `${usernameLower}@${FAKE_EMAIL_DOMAIN}`;
  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      throw new Error("Это имя пользователя уже занято");
    }
    throw new Error("Не удалось создать аккаунт: " + err.message);
  }

  // Аккаунт в Firebase Auth уже есть — пересоединяем сокет, чтобы сервер
  // узнал уже вошедшего пользователя, и "застолбливаем" имя в Redis
  // (атомарно: если кто-то успел раньше — вернётся ошибка "taken", и тогда
  // откатываем созданный аккаунт Firebase, как и раньше с Firestore).
  reauth();
  try {
    await call("register-profile", { username: usernameLower });
  } catch (err) {
    await deleteUser(credential.user).catch(() => {});
    if (err.message === "taken") {
      throw new Error("Это имя пользователя уже занято");
    }
    throw new Error("Не удалось сохранить профиль: " + err.message);
  }

  return credential.user.uid;
}

export async function login({ username, password }) {
  const usernameLower = normalizeUsername(username);
  const email = `${usernameLower}@${FAKE_EMAIL_DOMAIN}`;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error("Неверное имя пользователя или пароль");
  }

  // Пересоединяем сокет, чтобы сервер увидел уже вошедшего пользователя, и
  // на всякий случай досоздаём профиль в Redis (см. ensureProfile на
  // сервере) — это нужно только для аккаунтов, оставшихся ещё с тех времён,
  // когда профиль хранился в Firestore. Если что-то пойдёт не так — не
  // блокируем вход, экран чата и так покажет запасной ник.
  reauth();
  try {
    await call("ensure-profile", { username: usernameLower });
  } catch (err) {
    console.warn("Не удалось проверить/восстановить профиль:", err.message);
  }
}

export function logout() {
  return signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}
