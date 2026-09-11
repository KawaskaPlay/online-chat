import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Firebase Storage (фото/аватарки) пока не подключаем — не нужен платный
// план Blaze для базовой версии чата. См. README -> "Как добавить фото позже".
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// ВАЖНО: у этого проекта база Firestore создана НЕ с ID "(default)"
// (стандартным, который SDK использует, если не указать иначе), а с кастомным
// ID "online-chat-363a3" (совпадает с ID проекта — так вышло при создании
// базы в консоли). Поэтому база указывается явно вторым аргументом —
// без этого getFirestore(app) стучится в несуществующую "(default)" базу,
// и все чтения/записи зависают на ~30 сек и падают с "client is offline".
export const db = getFirestore(app, "online-chat-363a3");