# Client

React + Vite frontend for the text tools workspace.

## Run

```bash
npm ci
npm run dev
```

The dev server proxies API calls on `/api/*` to `http://localhost:3001`. Start the Express server from `../server` at the same time.

## Checks

```bash
npm run lint
npm run build
```

## Main screens

- `src/PersonaCompiler.jsx`
- `src/Summarizer.jsx`
- `src/LensSummarizer.jsx`
- `src/DraftApp.jsx`

Shared utilities include persisted local state, markdown rendering, file export helpers, and API response parsing. For full project setup, see the repo root `README.md`.
