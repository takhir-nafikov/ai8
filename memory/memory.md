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
  - `lessons/lesson5/index.html`
  - `lessons/lesson-6/index.html`
  - `lessons/lesson-7/index.html`
  - `lessons/lesson-8/index.html`
  - `lessons/lesson-9/index.html`
  - `lessons/lesson-10/index.html`
- Legacy compatibility page:
  - `lessons/lesson-1.html` -> redirects to `lessons/lesson1/`
- Lesson structure:
  - `lessons/lesson1/{index.html, lesson1.css, lesson1.js}`
  - `lessons/lesson2/{index.html, lesson2.css, lesson2.js}`
  - `lessons/lesson3/{index.html, lesson3.css, lesson3.js}`
  - `lessons/lesson4/{index.html, lesson4.css, lesson4.js}`
  - `lessons/lesson5/{index.html, lesson5.css, lesson5.js}`
  - `lessons/lesson-6/{index.html, lesson-6.css, lesson-6.js, llm-caller.js}`
  - `lessons/lesson-7/{index.html, lesson-7.css, lesson-7.js}`
  - `lessons/lesson-8/{index.html, lesson-8.css, lesson-8.js}`
  - `lessons/lesson-9/{index.html, lesson-9.css, lesson-9.js}`
  - `lessons/lesson-10/{index.html, lesson-10.css, lesson-10.js, week-placeholder.css}`
- Shared frontend files:
  - `src/main.js`
  - `src/config.js`
  - `src/styles.css`
  - `src/week-divider.css`
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
- Lesson 5 request body is JSON with:
  - `model`
  - `messages`
- Lesson 5 keeps lesson 4 history/preview flow but switches between `deepseek-v4-flash` and `deepseek-v4-pro`
- Lesson 5 measures response time on the client side and shows model/latency/token usage metadata
- Lesson 6 request body is JSON with:
  - `model`
  - `messages`
- Lesson 6 keeps question/answer/request-preview flow but sends requests through the `LLMCaller` class
- Lesson 7 request body is JSON with:
  - `model`
  - `messages`
- Lesson 7 reuses `LLMCaller` and stores the conversation history in browser `localStorage`
- Lesson 7 restores saved history on page load and keeps the same context for the next request
- Lesson 8 request body is JSON with:
  - `model`
  - `messages`
- Lesson 8 reuses `LLMCaller`, estimates prompt tokens on the client, and uses API `usage` to show actual token counts
- Lesson 8 reuses DeepSeek Flash pricing logic from lesson 5 to estimate input, output, and total cost
- Lesson 8 can append a chosen text-based file into the prompt, including `.txt`, `.md`, `.markdown`, `.json`, `.csv`, `.log`, `.yaml`, and `.yml`
- Lesson 8 no longer has a local context-limit gate in UI or request preview; large prompts are allowed and real API errors are shown separately
- Lesson 9 request body is JSON with:
  - `model`
  - `messages`
- Lesson 9 stores the current dialog state in `localStorage`, including history, summary-toggle state, and accumulated usage totals
- Lesson 9 can trigger a separate summary request after 10 non-summary messages when the auto-summary checkbox is enabled
- Lesson 9 rewrites the active history into one assistant summary message plus future messages, and counts token/cost usage for both normal and summary requests
- Lesson 10 request body is JSON with:
  - `model`
  - `messages`
- Lesson 10 demonstrates three context strategies:
  - Sliding Window sends and shows only the latest N messages in the active context view
  - Sticky Facts sends structured facts plus the dialog history and updates facts with a separate auxiliary model request; it does not expose context/history popup UI or message-limit UI
  - Branching behaves like a checkpoint-based branching system: before checkpoint it is a normal single chat, and after checkpoint it sends checkpoint history plus only the active branch tail
- Lesson 10 keeps token and cost totals for both main requests and auxiliary requests such as facts updates
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
- Task 4 added lesson 4 based on lesson 3 UI, but with three mutually exclusive temperature checkboxes: `0`, `0.7`, `1.2`
- Lesson 4 shows a more helpful network error if local dev server is unavailable
- Lesson 4 Markdown renderer now handles common cases like headings, lists, code blocks, inline code, blockquotes, `**bold**`, and `*italic*`
- Lesson 4 Markdown renderer was later strengthened to handle real model answers more stably, especially lists, blockquotes, and inline emphasis like `**Клиент-сервер**`
- Task 5 added lesson 5 based on lesson 4 UI, but with two mutually exclusive model checkboxes for Flash and Pro
- Lesson 5 shows selected model, client-side response time, and token usage metadata if the API/proxy returns `usage`
- Proxy now passes `usage` through to the frontend so later UI can show token cost if pricing is added manually
- Lesson 5 now estimates token cost using configured Flash/Pro prices; because cache hit/miss is unknown from API, input and total cost are shown as a range
- Task 6 added a week divider on the main page and a `Вторая неделя` block with lessons 6-10
- Task 6 created separate folders and separate pages for `lesson-6` through `lesson-10`
- Task 6 added lesson 6 with a question field, answer block, request preview, and history reset button
- Task 6 moved lesson 6 DeepSeek request building, sending, response parsing, and error handling into `lessons/lesson-6/llm-caller.js`
- Task 7 replaced the lesson 7 placeholder with a full page based on lesson 6
- Task 7 stores lesson 7 history in `localStorage` under a JSON array of `{ role, content }`
- Task 7 added a modal history viewer and supports clearing history from the main page and the modal
- Task 8 replaced the lesson 8 placeholder with a token-and-cost demo page based on lessons 5-7
- Task 8 reuses the lesson 5 price table for `deepseek-v4-flash` and shows estimated and actual token/cost data
- Task 8 adds a text file picker that injects file content into the next prompt and supports Markdown plus other plain-text formats
- Task 8 relies on real API errors for oversized prompts instead of a fake local context limit
- Task 9 replaces the lesson 9 placeholder with a dialog page based on lesson 7, but with token/cost totals from lesson 8
- Task 9 stores lesson 9 history separately in `localStorage` and can show it in a modal without rendering request body by default
- Task 9 adds optional auto-summary after 10 messages; summary uses a separate model request and rewrites active history into a compact assistant summary
- Task 10 replaces the lesson 10 placeholder with a context-management demo page based on lesson 9
- Task 10 adds strategy switching between Sliding Window, Sticky Facts, and Branching with separate UI blocks
- Task 10 adds facts updates through a separate model request and separate branch histories with checkpoint-based branch creation
- Task 10 was refined so strategies are mutually exclusive radio buttons, Sliding Window history popup shows only the active window, Sticky Facts uses a modal facts viewer plus a dynamic key-value facts object, and Branching now creates branches A/B directly from a checkpoint while keeping branch-specific post-checkpoint messages isolated
- Lesson 10 radio buttons stay switchable after strategy changes, and Sticky Facts keeps facts as an additional layer over the dialog history instead of replacing conversation messages
- Lesson 10 does not expose an active-context payload preview; Sticky Facts has no message-count limit and sends its full dialog history together with durable facts
- Lesson 10 Sticky Facts hides the generic history/context button, keeps the facts modal close button enabled, and does not show prompt-estimate or active-context message-count UI
- Lesson 10 Branching keeps checkpoint creation and branch switching controls enabled for manual checkpoint-based branching

## Git State / Branching

- Remote `origin` -> `https://github.com/takhir-nafikov/ai8`
- Current working branch for this task: `task-6`
- `task-2` was created locally from `task-1`
- `Task3` was created locally from `task-2`
- `task-4` was created locally from `Task3`
- `task-5` was created locally from `task-4`
- `task-6` was created locally from `task-5`
- `task-7` was created locally from `task-6`
- `task-8` was created locally from `task-7`
- `task-9` was created locally from `task-8`
- `task-10` was created locally from `task-9`

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
- For lesson 6, inspect `lessons/lesson-6/llm-caller.js` first if the request format or error handling changes
- For lesson 7, inspect `lessons/lesson-7/lesson-7.js` first if persistence, modal history view, or localStorage recovery changes
- For lesson 8, inspect `lessons/lesson-8/lesson-8.js` first if token estimation, file injection, accepted file types, or API-error handling changes
- For lesson 9, inspect `lessons/lesson-9/lesson-9.js` first if summary thresholds, history rewriting, or accumulated token/cost totals change
- For lesson 10, inspect `lessons/lesson-10/lesson-10.js` first if context strategy rules, facts updates, or branching behavior change
