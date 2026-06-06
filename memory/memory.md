# Repo Memory

## Current State

- Static study site without frameworks.
- Frontend stack: plain HTML, CSS, vanilla JS.
- Main pages:
  - `index.html`
  - `lessons/lesson1/index.html`
  - `lessons/lesson2/index.html`
  - `lessons/lesson3/index.html`
  - `lessons/lesson4/index.html`
  - `lessons/lesson4/index.html`
- Legacy compatibility page:
  - `lessons/lesson-1.html` -> redirects to `lessons/lesson1/`
- Lesson structure:
  - `lessons/lesson1/{index.html, lesson1.css, lesson1.js}`
  - `lessons/lesson2/{index.html, lesson2.css, lesson2.js}`
  - `lessons/lesson3/{index.html, lesson3.css, lesson3.js}`
  - `lessons/lesson4/{index.html, lesson4.css, lesson4.js}`
  - `lessons/lesson4/{index.html, lesson4.css, lesson4.js}`
- Shared frontend files:
  - `src/main.js`
  - `src/config.js`
  - `src/styles.css`
  - `src/lesson1.js` now works as a shim import for the relocated lesson 1 script

## Runtime Flow

- Frontend should be opened through local dev server, not `file://`.
- Local dev server: `server/dev-server.mjs`
- Static preview server: `server/static-server.mjs`
- Frontend loads runtime config from `GET /api/config`
- Frontend sends lesson request to `POST /api/deepseek`
- Lesson 1 request body is JSON with:
  - `input`
  - `model`
- Lesson 2 request body is JSON with:
  - `model`
  - `messages`
  - optional `temperature`
  - optional `max_tokens`
  - optional `stop`
- Lesson 3 request body is JSON with:
  - `model`
  - `messages`
- Lesson 3 modifies the final user message on the client side before sending it to Chat Completions
- Lesson 4 request body is JSON with:
  - `model`
  - `messages`
  - optional `temperature`
- Lesson 4 keeps lesson 3 history/preview flow but controls `temperature` instead of modifying prompt text
- Lesson 4 renders model answers as HTML from a small safe Markdown renderer on the client side
- Proxy accepts either `input` or non-empty `messages`
- Proxy prepends the system message on the backend side
- Dev server now resolves folder URLs like `/lessons/lesson1/` to `index.html`

## DeepSeek Notes

- Actual working model name is `deepseek-v4-flash`
- `deepseek-v4-pro` is also accepted by proxy allowlist, but default runtime config is still `deepseek-v4-flash`
- Old `deepseek-flash` name became outdated for current DeepSeek API
- Chat Completions endpoint in use: `https://api.deepseek.com/chat/completions`
- `.env.example`, `public/app-config.js`, `src/config.js`, `README.md`, and `server/dev-server.mjs` were aligned to current DeepSeek V4 naming
- API key must stay only in `.env` / backend environment, never in frontend

## Important Fixes Already Done

- Fixed lesson page so submit is handled through `event.preventDefault()`
- Text should not go into URL anymore
- Request is sent with `fetch` as `POST`
- Endpoint and model are shown on lesson page
- Added runtime config endpoint `/api/config`
- Added basic console logging for endpoint/model/response status
- Added visible config error block on lesson page
- Added `server/*.log` to `.gitignore`
- Grouped each lesson into its own folder
- Added lesson 2 with request settings UI
- Added scrollable response block and scrollable request body block for lesson 2
- Added in-memory conversation history for lesson 2
- Added history reset button for lesson 2
- Updated proxy to support both old `input` flow and new `messages` flow
- Added lesson 3 based on lesson 2 layout and interaction model
- Replaced lesson 2 model-parameter checkboxes in lesson 3 with prompt-transform checkboxes
- Lesson 3 supports three prompt transforms:
  - append `Решай пошагово.`
  - ask the model to build a copyable high-quality prompt instead of solving directly
  - ask for separate viewpoints from analyst, engineer, and critic
- Lesson 3 keeps in-memory conversation history and still shows endpoint plus full request body

## Git State / Branching

- Remote `origin` -> `https://github.com/takhir-nafikov/ai8`
- Current working branch for this task: `Task3`
- `task-2` was created locally from `task-1`
- `Task3` was created locally from `task-2`
- `task-4` was created locally from `Task3`

## Local Run

- Dev server:
  - `npm run dev`
- Static preview:
  - `npm run preview`
- Expected dev URL:
  - `http://localhost:4173`

## Things To Watch Next

- If POST fails again, first check `/api/config`
- If browser submits to URL, user likely opened page via `file://` or JS failed to load
- If port `4173` is busy, stop old node process before restart
- Keep README and `.env.example` in sync with actual server behavior
- For lesson 2, inspect returned `requestBody` to verify `messages` history and optional params
- Keep lesson 1 backward-compatible while evolving proxy for lesson 2
- Lesson 3 now exists with three prompt-modifying checkboxes: step-by-step mode, prompt-only mode, and multi-expert mode
- Lesson 3 reuses lesson 2 visual style by importing `../lesson2/lesson2.css`
- If lesson 3 behavior is changed later, inspect `lessons/lesson3/lesson3.js` first: prompt transformation happens in `buildPrompt()`
- Task 4 added lesson 4 based on lesson 3 UI, but with three mutually exclusive temperature checkboxes: `0`, `0.7`, `1.2`
- Lesson 4 shows a more helpful network error if local dev server is unavailable
- Lesson 4 Markdown renderer now handles common cases like headings, lists, code blocks, inline code, blockquotes, `**bold**`, and `*italic*`
- Lesson 4 Markdown renderer was later strengthened to handle real model answers more stably, especially lists, blockquotes, and inline emphasis like `**Клиент-сервер**`
