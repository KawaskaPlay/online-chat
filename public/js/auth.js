import { auth, db } from "./firebase-init.js";
import { FAKE_EMAIL_DOMAIN } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username) {
  return USERNAME_RE.test(username.trim());
}

export async function isUsernameTaken(username) {
  const usernameLower = normalizeUsername(username);
  const snap = await getDoc(doc(db, "usernames", usernameLower));
  return snap.exists();
}

export async function register({ username, password }) {
  const usernameLower = normalizeUsername(username);

  if (!isValidUsername(username)) {
    throw new Error("Имя пользователя: 3-20 символов, латинские буквы, цифры и _");
  }
  if (password.length < 6) {
    throw new Error("Пароль должен быть не короче 6 символов");
  }
  if (await isUsernameTaken(usernameLower)) {
    throw new Error("Это имя пользователя уже занято");
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
  const uid = credential.user.uid;

  try {
    // "Застолбить" имя пользователя. Правила Firestore (firestore.rules)
    // разрешают только create, не update — поэтому если кто-то успел
    // зарегистрировать это же имя долей секунды раньше, эта запись не пройдёт.
    await setDoc(doc(db, "usernames", usernameLower), { uid });
  } catch (err) {
    await deleteUser(credential.user).catch(() => {});
    throw new Error("Это имя пользователя только что заняли, попробуйте другое");
  }

  await setDoc(doc(db, "users", uid), {
    username: usernameLower,
    // Загрузка своей аватарки пока отключена (нужен платный план Blaze для
    // Firebase Storage) — используется автоматический цветной аватар с
    // буквой имени, см. ui-helpers.js -> renderAvatar(). Когда решите
    // включить Storage, здесь можно вернуть загрузку файла.
    avatarUrl: null,
    createdAt: serverTimestamp(),
  });

  return uid;
}

export async function login({ username, password }) {
  const usernameLower = normalizeUsername(username);
  const email = `${usernameLower}@${FAKE_EMAIL_DOMAIN}`;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error("Неверное имя пользователя или пароль");
  }
}

export function logout() {
  return signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}
