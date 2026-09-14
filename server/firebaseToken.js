// Проверка Firebase ID-токена БЕЗ пакета firebase-admin и БЕЗ сервисного
// ключа (service account). Один раз в этом проекте такой ключ уже случайно
// попал в публичный код (см. историю в git) — с тех пор в этом проекте
// сервисные ключи принципиально не используются.
//
// ID-токен — это обычный подписанный JWT. Firebase публикует открытые
// (публичные, не секретные) ключи, которыми можно проверить подпись любого
// токена, выданного вашим проектом — этого достаточно, чтобы убедиться, что
// токен настоящий и узнать uid пользователя (поле "sub"). Приватная половина
// этой пары ключей есть только у серверов Google — её мы никогда не видим и
// она не нужна.

const crypto = require("crypto");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "online-chat-363a3";
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedKeys = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // час — Google меняет эти ключи нечасто

async function getJwks() {
  const now = Date.now();
  if (cachedKeys && now - cachedAt < CACHE_TTL_MS) return cachedKeys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) {
    throw new Error("Не удалось получить публичные ключи Google (JWKS): " + res.status);
  }
  const data = await res.json();
  cachedKeys = data.keys;
  cachedAt = now;
  return cachedKeys;
}

function b64urlToBuffer(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

// Возвращает { uid, email } или бросает ошибку с понятным сообщением.
async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== "string" || idToken.split(".").length !== 3) {
    throw new Error("Некорректный токен");
  }
  const [headerB64, payloadB64, sigB64] = idToken.split(".");

  let header, payload;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8"));
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString("utf8"));
  } catch {
    throw new Error("Не удалось разобрать токен");
  }

  if (header.alg !== "RS256") throw new Error("Неожиданный алгоритм подписи токена");

  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Не найден ключ для проверки подписи (kid не совпал)");

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(headerB64 + "." + payloadB64);
  verifier.end();
  const signatureValid = verifier.verify(publicKey, b64urlToBuffer(sigB64));
  if (!signatureValid) throw new Error("Подпись токена не совпадает");

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("Токен истёк");
  }
  if (typeof payload.iat === "number" && payload.iat > nowSec + 60) {
    throw new Error("Токен выдан в будущем — подозрительно");
  }
  if (payload.aud !== PROJECT_ID) throw new Error("Токен выдан для другого проекта Firebase");
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) {
    throw new Error("Неверный издатель токена");
  }
  if (!payload.sub) throw new Error("В токене нет uid (sub)");

  return { uid: payload.sub, email: payload.email || null };
}

module.exports = { verifyFirebaseIdToken };
