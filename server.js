const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Все данные (аккаунты, чаты, сообщения, фото) хранятся в Firebase —
// сервер тут нужен только чтобы отдавать статические файлы фронтенда.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Страниц у нас всего две (index.html и chat.html), поэтому неизвестные
// пути просто отправляем на главную.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
