import { auth } from "./firebase-init.js";

// Один Socket.IO-клиент на страницу. Библиотека socket.io-client подключена
// как обычный <script> в index.html/chat.html (до этого модуля) — она кладёт
// глобальную функцию `io`. Подключаемся к тому же адресу, откуда загружена
// страница: сервер отдаёт и статику, и сокеты на одном порту.
const socket = io({
  // Не подключаемся сразу — см. ниже, почему.
  autoConnect: false,
  // auth — функция, которую Socket.IO вызывает перед КАЖДОЙ попыткой
  // подключения (и переподключения). Так сокет всегда несёт свежий
  // ID-токен текущего пользователя Firebase, а не тот, что был при первой
  // загрузке страницы (когда пользователь ещё мог быть не залогинен).
  auth: (cb) => {
    const user = auth.currentUser;
    if (!user) {
      cb({});
      return;
    }
    user
      .getIdToken()
      .then((token) => cb({ token }))
      .catch(() => cb({}));
  },
});

// auth.currentUser сразу после загрузки страницы почти всегда ещё null —
// Firebase восстанавливает сохранённую сессию асинхронно (читает IndexedDB),
// и это занимает какое-то время. Если бы сокет подключался сразу
// (autoConnect по умолчанию), функция auth() выше почти наверняка успела бы
// вызваться до того, как currentUser появится, — и сокет остался бы
// анонимным на весь дальнейший сеанс (переподключение само по себе больше
// не происходит). authStateReady() — это промис именно на "начальное
// состояние авторизации уже определено" (сессия найдена или её точно нет),
// поэтому ждём его перед первым подключением сокета.
auth.authStateReady().then(() => socket.connect());

export function getSocket() {
  return socket;
}

// Сразу после входа/регистрации auth.currentUser меняется, но уже открытое
// соединение продолжает жить с тем состоянием авторизации, что было на
// момент подключения. Пересоединяемся, чтобы сервер увидел уже вошедшего
// пользователя (функция auth выше сама подставит новый токен).
export function reauth() {
  socket.disconnect();
  socket.connect();
}

// Обёртка над socket.emit(event, payload, ack) в виде Promise — с сервером
// общаемся в стиле "вызов функции", а не вручную возимся с колбэками.
export function call(event, payload = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Сервер не отвечает")), timeoutMs);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      if (res?.ok) resolve(res);
      else reject(new Error(res?.error || "Неизвестная ошибка сервера"));
    });
  });
}
