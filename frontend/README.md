# Student Workspace — frontend

Vite + React 19 + TypeScript + Tailwind v4 (shadcn-ready). React port of the original HTML prototype
(`../Student Workspace.dc.html`): Slack-style shell with rail · sidebar · pane · right panel.

```bash
npm install
npm run dev        # http://localhost:5173 — mock data by default
npm run build      # type-check + production build to dist/
```

Needs Node 20+ (tested on 22.11 and 22.22). The toolchain is pinned to Vite 6 on purpose: Vite 7/8 need Node
≥ 22.12, and on older Node npm silently skips their native binding ("Cannot find native binding"). If you ever see
that error, run `rm -rf node_modules && npm install` — don't delete `package-lock.json`, and don't bump Vite past 6 or
oxlint past 1.16 unless everyone on the team is on Node ≥ 22.12.

## Mock vs real backend

| Setting | Effect |
|---|---|
| `VITE_MOCK` unset / `true` | In-browser mock server (`src/api/mock/`). Top bar shows a **Mock data** badge. |
| `VITE_MOCK=false` | Calls the FastAPI backend at `VITE_API_URL` (default `/api`, proxied by Vite to `http://localhost:8000`). |
| `?mock=0` / `?mock=1` in the URL | Overrides the env for a quick flip. |

Set `API_PROXY_TARGET` to proxy `/api` somewhere other than `http://localhost:8000`. Copy `.env.example` to `.env.local` to change the defaults.

The mock is canned and keyword-routed. It exists so the UI keeps working all day; never demo it as real output.
Try "fail" in any DM to see the error marker + retry path.

## Layout

```
src/types.ts              copy of ../contracts.ts (npm run sync-types) — the source of truth
src/api/client.ts         Api interface: one method per endpoint in contracts.ts §10
src/api/http.ts           FastAPI client
src/api/mock/             mock data (contract-shaped) + in-memory mock server
src/store/workspace.ts    Zustand store: data loading, send/retry, escalation polling, UI state
src/lib/route.ts          hash router  (#/dm/:agent  #/channel/:id  #/files[/:doc[/:section]]  #/agents  #/advisor)
src/components/cards/     one renderer per Card type
src/components/shell/     TopBar · Rail · Sidebar · RightPanel
src/components/views/     DM · channel · files · document reader · agents & tools · advisor desk
src/components/chat/      message row (trace, sources, escalation) + composer
```

Notes

- Citations: `[C1]` in message text renders a pill that previews the quote on hover and opens the source in the right
  panel (or the document reader outside DMs). Card `citationIds` resolve against the citations of the message that
  carried the card. Cards read from `StudentState` have no `Citation` objects, so they render without pills.
- Anything not built has a `data-tip="Coming soon"` tooltip, never a dead click.
- Study Buddy / Weekly 1:1 (`one_on_one` cards) is held per AGENTS.md §4.5 and not rendered.
