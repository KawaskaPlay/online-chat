import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// Firestore больше не используется: чаты, сообщения и профили теперь
// хранятся в Redis на сервере (см. server.js, server/chatStore.js). Firebase
// здесь отвечает только за вход и регистрацию (Firebase Authentication).
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
