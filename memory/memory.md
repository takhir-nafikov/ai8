# Repo Memory

## Current State

- Static study site without frameworks.
- Frontend stack: plain HTML, CSS, vanilla JS.
- Main pages:
  - `index.html`
  - `lessons/lesson-1.html`
- Frontend scripts/styles:
  - `src/main.js`
  - `src/lesson1.js`
  - `src/config.js`
  - `src/styles.css`

## Runtime Flow

- Frontend should be opened through local dev server, not `file://`.
- Local dev server: `server/dev-server.mjs`
- Static preview server: `server/static-server.mjs`
- Frontend loads runtime config from `GET /api/config`
- Frontend sends lesson request to `POST /api/deepseek`
- Request body is JSON with:
  - `input`
  - `model`

## DeepSeek Notes

- Actual working model name is `deepseek-v4-flash`
- Old `deepseek-flash` name became outdated for current DeepSeek API
- `.env.example`, `public/app-config.js`, `src/config.js`, `README.md`, and `server/dev-server.mjs` were aligned to `deepseek-v4-flash`
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

## Git State / Branching

- Remote `origin` -> `https://github.com/takhir-nafikov/ai8`
- Working branch used for this task: `task-1`
- Initial feature commit already pushed to `origin/task-1`

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
