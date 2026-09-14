const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.warn(
    "[redis] Переменная окружения REDIS_URL не задана — чат работать не будет. " +
      "См. README про бесплатный Redis (Upstash) и настройку переменных окружения на Render."
  );
}

// Обычный клиент — для команд (GET/SET/HSET/ZADD/...).
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });

// Отдельное соединение для подписки (Redis Pub/Sub). Соединение, которое
// сделало SUBSCRIBE, больше не может выполнять обычные команды — поэтому
// нужно два независимых клиента, один только слушает, второй только пишет.
const redisSub = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });

redis.on("error", (err) => console.error("[redis] error:", err.message));
redisSub.on("error", (err) => console.error("[redis:sub] error:", err.message));

module.exports = { redis, redisSub };
