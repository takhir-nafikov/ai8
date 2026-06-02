# AI8 Study Site

Минимальный учебный статический сайт без фреймворков и библиотек. Проект использует только HTML, CSS и vanilla JavaScript, запускается без сборки и подходит для дальнейшего деплоя на GitHub Pages.

## Что внутри

- Главная страница со списком уроков.
- Страница `Урок 1` с базовой формой отправки и состояниями `loading / error / success`.
- Страница `Урок 2` с расширенными настройками Chat Completions и локальной историей контекста.
- Фронтенд обращается не напрямую к DeepSeek, а к настраиваемому backend endpoint `apiEndpoint`.
- Локальный `dev server` умеет:
  - работать как mock, если API ключ не задан;
  - работать как proxy к DeepSeek, если ключ задан в `.env`;
  - отдавать runtime-config через `/api/config`, чтобы страница видела текущие `endpoint` и `model`.

## Структура проекта

```text
.
├─ index.html
├─ lessons/
│  ├─ lesson-1.html
│  ├─ lesson1/
│  │  ├─ index.html
│  │  ├─ lesson1.css
│  │  └─ lesson1.js
│  └─ lesson2/
│     ├─ index.html
│     ├─ lesson2.css
│     └─ lesson2.js
├─ memory/
│  └─ memory.md
├─ public/
│  └─ app-config.js
├─ server/
│  ├─ dev-server.mjs
│  └─ static-server.mjs
├─ src/
│  ├─ config.js
│  ├─ lesson1.js
│  ├─ main.js
│  └─ styles.css
├─ .env.example
├─ package.json
└─ README.md
```

## Установка

Требуется `Node.js 20+`.

```bash
npm install
```

Сейчас у проекта нет обязательных npm-зависимостей, поэтому `npm install` нужен только для привычного npm workflow и возможного дальнейшего расширения.

## Локальный запуск

1. Скопируйте шаблон переменных окружения:

```bash
cp .env.example .env
```

На Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

2. Запустите dev server:

```bash
npm run dev
```

Сайт будет доступен по адресу `http://localhost:4173`.
Страницы уроков должны открываться через `http://localhost:4173`, а не через `file://...`, иначе submit/fetch и runtime-config будут работать некорректно.

## Запуск без npm

Так как это обычный статический сайт, главную страницу можно открыть и напрямую как файл:

- `index.html`

Но для проверки `Урока 1` и `Урока 2` нужен локальный сервер, потому что формы обращаются к `/api/deepseek`.

## Локальный просмотр только статики

```bash
npm run preview
```

## Как проверить уроки локально

### Вариант 1. Mock режим

Если `.env` отсутствует или `DEEPSEEK_API_KEY` не задан, локальный сервер автоматически отвечает mock-данными. Это удобно для верстки и проверки состояний интерфейса.

Также можно явно включить mock:

```env
MOCK_DEEPSEEK=true
```

### Вариант 2. Реальный proxy к DeepSeek

Заполните `.env`:

```env
DEEPSEEK_API_KEY=your_secret_key
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-flash
MOCK_DEEPSEEK=false
```

Потом запустите:

```bash
npm run dev
```

Фронтенд будет:

- загружать runtime-config с `/api/config`;
- показывать на странице текущие `endpoint` и `model`;
- отправлять `POST` JSON-запрос на `/api/deepseek`;
- получать ответ от локального proxy-сервера.

### Урок 1

URL:

- `http://localhost:4173/lessons/lesson1/`

Пример body запроса:

```json
{
  "input": "Объясни, как работает REST API",
  "model": "deepseek-v4-flash"
}
```

Старый URL `lessons/lesson-1.html` сохранён как совместимый редирект на новую папку урока.

### Урок 2

URL:

- `http://localhost:4173/lessons/lesson2/`

Урок 2 повторяет базовый сценарий lesson 1, но дополнительно:

- показывает `endpoint` и полное `request body`;
- позволяет включать `temperature`, `max_tokens` и `stop`;
- хранит локальную историю сообщений в памяти страницы;
- при новом запросе отправляет полный массив `messages` в формате Chat Completions API;
- позволяет очистить историю отдельной кнопкой.

Пример body запроса:

```json
{
  "model": "deepseek-v4-flash",
  "messages": [
    {
      "role": "user",
      "content": "Первый вопрос"
    },
    {
      "role": "assistant",
      "content": "Первый ответ"
    },
    {
      "role": "user",
      "content": "Второй вопрос"
    }
  ],
  "temperature": 0.2,
  "max_tokens": 300,
  "stop": ["стоп"]
}
```

Proxy не требует одновременной передачи `input` и `messages`:

- lesson 1 продолжает работать через `input`;
- lesson 2 использует `messages`;
- сервер добавляет системное сообщение на backend-стороне.

## Почему нельзя хранить API key на GitHub Pages

GitHub Pages отдает только статические файлы в браузер пользователя. Любой ключ, встроенный во фронтенд или положенный в доступный клиенту конфиг, окажется в опубликованном JavaScript и станет публичным.

Поэтому для production нельзя:

- хранить настоящий DeepSeek API key во фронтенде;
- подставлять секрет в клиентский `.env`;
- делать прямой запрос из GitHub Pages в DeepSeek с приватным ключом.

Правильная схема:

1. Статический фронтенд на GitHub Pages.
2. Отдельный backend / proxy / serverless endpoint.
3. API key хранится только на стороне сервера.
4. Фронтенд вызывает только публичный proxy endpoint.

## Как позже подключить production proxy

1. Поднимите внешний endpoint, например:
   - `https://your-domain.example/api/deepseek`
   - serverless function на Vercel / Netlify / Cloudflare Workers / AWS Lambda
2. Храните `DEEPSEEK_API_KEY` только в секрете backend-среды.
3. Оставьте во фронтенде только публичный URL proxy.
4. Измените `public/app-config.js`, чтобы `apiEndpoint` указывал на production proxy, либо реализуйте аналог `/api/config` на production backend.

Пример:

```js
window.__APP_CONFIG__ = {
  apiEndpoint: "https://your-domain.example/api/deepseek",
  model: "deepseek-v4-flash"
};
```

После этого опубликуйте проект на GitHub Pages как обычную статическую папку с HTML, CSS и JS.

## Почему выбран multi-page подход

Для GitHub Pages надежнее использовать обычные HTML-файлы:

- `index.html`
- `lessons/lesson1/index.html`
- `lessons/lesson2/index.html`

Так не нужен клиентский router и не возникает проблем с fallback-маршрутизацией на статическом хостинге.

## Расширение проекта

Чтобы добавить следующий урок:

1. Создайте новую папку урока внутри `lessons/`.
2. Положите в неё собственные `index.html`, CSS и JS файла урока.
3. При необходимости переиспользуйте общий `src/styles.css` и `src/config.js`.
4. Обновите список уроков на главной странице.
5. Если используете локальный сервер, просто перезапустите `npm run dev`.
