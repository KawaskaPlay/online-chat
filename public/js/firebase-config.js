// Настройки вашего Firebase-проекта.
// Взять их можно тут: Firebase Console -> Project settings (шестерёнка) ->
// вкладка General -> раздел "Your apps" -> веб-приложение -> SDK setup and
// configuration -> Config.
//
// Это НЕ секретный ключ — для веб-приложений Firebase такие настройки
// принято открыто хранить в коде клиента. Безопасность обеспечивают правила
// доступа (firestore.rules и storage.rules), а не секретность этого файла.
//
// ВАЖНО: сюда нужен именно веб-конфиг (apiKey/authDomain/...), а НЕ файл
// сервисного аккаунта (service_account JSON с private_key) — тот выдаётся
// для сервера и НИКОГДА не должен попадать в папку public/ или в git.
export const firebaseConfig = {
  apiKey: "AIzaSyDGjOkcRtdEnE4KApqiJ8YUcumLr662114",
  authDomain: "online-chat-363a3.firebaseapp.com",
  projectId: "online-chat-363a3",
  storageBucket: "online-chat-363a3.firebasestorage.app",
  messagingSenderId: "297992356529",
  appId: "1:297992356529:web:dfe8f070bdfd0ba5ac9890",
};

// Firebase Authentication (в режиме email/password) требует email, а не
// username. Поэтому внутри мы превращаем "username" в
// "username@chatapp.local" — обычный пользователь этого не видит.
export const FAKE_EMAIL_DOMAIN = "chatapp.local";