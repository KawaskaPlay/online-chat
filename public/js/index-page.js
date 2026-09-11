import { watchAuthState, login, register, isUsernameTaken, isValidUsername } from "./auth.js";

// Если пользователь уже вошёл — сразу переходим в чат.
watchAuthState((user) => {
  if (user) window.location.href = "chat.html";
});

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");
});

tabRegister.addEventListener("click", () => {
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const submitBtn = loginForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    await login({ username, password });
    window.location.href = "chat.html";
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// Проверка доступности имени пользователя "на лету", с небольшой задержкой,
// чтобы не дёргать базу при каждом нажатии клавиши.
const usernameInput = document.getElementById("register-username");
const usernameHint = document.getElementById("username-hint");
let checkTimer = null;

usernameInput.addEventListener("input", () => {
  const value = usernameInput.value;
  clearTimeout(checkTimer);
  usernameHint.textContent = "";
  usernameHint.className = "hint";

  if (!value) return;
  if (!isValidUsername(value)) {
    usernameHint.textContent = "3-20 символов: латинские буквы, цифры, _";
    usernameHint.className = "hint hint-error";
    return;
  }
  checkTimer = setTimeout(async () => {
    usernameHint.textContent = "Проверяем...";
    try {
      const taken = await isUsernameTaken(value);
      usernameHint.textContent = taken ? "✗ уже занято" : "✓ доступно";
      usernameHint.className = "hint " + (taken ? "hint-error" : "hint-ok");
    } catch (err) {
      usernameHint.textContent = "";
    }
  }, 400);
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("register-error");
  errorEl.textContent = "";

  const username = usernameInput.value;
  const password = document.getElementById("register-password").value;
  const password2 = document.getElementById("register-password2").value;

  if (password !== password2) {
    errorEl.textContent = "Пароли не совпадают";
    return;
  }

  const submitBtn = registerForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    await register({ username, password });
    window.location.href = "chat.html";
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
