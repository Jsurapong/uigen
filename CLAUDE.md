# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

UIGen is an AI-powered React component generator with live in-browser preview. Users chat with Claude to generate React components, which are written to a **virtual file system** (in-memory, not on disk), transformed in the browser via Babel Standalone, and rendered inside an iframe preview with Tailwind CDN.

## Common commands

```bash
npm run setup        # install deps + prisma generate + prisma migrate dev (run once)
npm run dev          # dev server on :3000 (turbopack) with node-compat shim
npm run dev:daemon   # same, backgrounded, logs to logs.txt
npm run build        # production build
npm run lint         # next lint
npm run test         # vitest (jsdom)
npm run test -- src/lib/__tests__/file-system.test.ts   # single test file
npm run db:reset     # reset SQLite via prisma migrate reset --force
```

All `next` commands are launched via `NODE_OPTIONS='--require ./node-compat.cjs'`. `node-compat.cjs` deletes global `localStorage`/`sessionStorage` on Node ≥25 so SSR code that guards on `typeof localStorage === "undefined"` keeps working — do not remove this shim.

`ANTHROPIC_API_KEY` in `.env` is optional. When absent, `src/lib/provider.ts` falls back to `MockLanguageModel`, which returns a canned multi-step tool-call script (counter/form/card) so the full UI flow can be demoed without credits. The real model ID is hard-coded to `claude-haiku-4-5` in `provider.ts:8`.

## Architecture

### Virtual file system (core abstraction)
`src/lib/file-system.ts` defines `VirtualFileSystem` — an in-memory tree of `FileNode`s. **No files are ever written to disk.** The same class runs on both server (inside the `/api/chat` route handler) and client (inside `FileSystemProvider`), and is serialized to/from JSON when persisting projects or streaming state between them. When the LLM calls tools, it mutates a server-side instance; the client maintains its own mirror that is updated as tool-call deltas stream in.

### AI chat loop
`src/app/api/chat/route.ts` is the single AI endpoint. It:
1. Prepends `generationPrompt` (from `src/lib/prompts/generation.tsx`) as a system message with Anthropic ephemeral cache control.
2. Reconstructs a `VirtualFileSystem` from the `files` payload via `deserializeFromNodes`.
3. Streams `streamText` with two tools: `str_replace_editor` (view/create/str_replace/insert — mirrors Anthropic's text_editor tool shape) and `file_manager` (rename/delete).
4. On finish, if `projectId` + authenticated session exist, persists `messages` (via `appendResponseMessages`) and `data` (serialized FS) to the `Project` row.

`maxSteps` is 40 for real Anthropic, **4 for mock** — the mock provider deliberately returns `finishReason: "tool-calls"` on each step to drive a scripted sequence, and would loop forever at 40.

### Preview rendering (`src/lib/transform/jsx-transformer.ts`)
Runs entirely in the browser. For every JSX/TSX file in the virtual FS:
1. Babel Standalone transforms it with `react` (automatic runtime) + optional `typescript` preset.
2. The output is wrapped in a `Blob` and exposed via `URL.createObjectURL`.
3. An ESM **import map** is built mapping every local path (and its `@/` alias / extensionless / no-leading-slash variants) to its blob URL, and unknown bare imports to `https://esm.sh/<pkg>`.
4. `createPreviewHTML` emits an HTML document with Tailwind CDN, the import map, and a dynamic `import(entryPoint)` that mounts `App` inside an `ErrorBoundary`. Syntax errors render as a styled error panel instead of mounting React.

Missing local imports are stubbed with `createPlaceholderModule` so a partial project still previews. The entry point is always `/App.jsx` — this is enforced by the system prompt.

### Auth & persistence
- `src/lib/auth.ts` — JWT sessions via `jose` in an httpOnly `auth-token` cookie (7d). `JWT_SECRET` env var (falls back to `development-secret-key`).
- `src/middleware.ts` only guards `/api/projects` and `/api/filesystem` (neither currently exists as a route — middleware is forward-looking). `/api/chat` is intentionally open; the route itself checks `getSession()` before persisting.
- `src/lib/anon-work-tracker.ts` stashes messages + FS in `sessionStorage` for anonymous users so work survives sign-up.
- Prisma schema (`prisma/schema.prisma`) has `User` and `Project`; messages + FS data are stored as serialized JSON strings on `Project`. **The Prisma client is generated to `src/generated/prisma`**, not `node_modules/.prisma` — import from `@/lib/prisma` which wraps this.

### Frontend shell
`src/app/page.tsx` redirects authed users to their latest project (or creates one); anonymous users see `MainContent` directly. `MainContent` (`src/app/main-content.tsx`) composes `FileSystemProvider` + `ChatProvider` around a three-pane `ResizablePanelGroup`: chat · (FileTree + CodeEditor | PreviewFrame). The chat context applies streamed tool calls to the client-side `VirtualFileSystem`, which drives both the editor and the iframe preview.

UI primitives in `src/components/ui` are shadcn/ui (see `components.json`). Styling is Tailwind v4 via `@tailwindcss/postcss`.

## Testing

Vitest with `jsdom` environment and `vite-tsconfig-paths` for `@/` alias resolution. Tests live in `__tests__/` dirs colocated with source (`src/lib/__tests__`, `src/lib/contexts/__tests__`, `src/lib/transform/__tests__`, `src/components/{chat,editor}/__tests__`). No global setup file — React Testing Library is imported per test.
