# Fluxo

Git branch viewer for Windows. It shows what is happening in your repositories live, including private GitHub and Azure DevOps repos, even when the changes come from an AI agent in the terminal. Fluxo supervises: most of the work is reading the repo, and the few actions that write to it check first whether they can be done.

Current version: **0.1.0** (beta). 1.0.0 ships when the beta ends.

## What it does

### Live repositories

- The graph updates itself whenever the repo changes, no matter who changed it: the app, the terminal or an agent.
- The **WIP** row shows edited files that are not committed yet.
- Several repos in tabs (Ctrl+T, Ctrl+W, Ctrl+Tab), with a recent list. The last one reopens on startup. Every open tab is watched: going back to one shows its state instantly, with no reload if nothing changed.
- Automatic fetch, branches with the commits left to push and pull, and a notice when a merge, rebase, cherry pick, revert or bisect is in progress, with its conflict count.
- GitHub and Azure DevOps pull requests in the left panel; open a commit, a branch or its PR on the web.
- Worktree and stash panels.

### Reviewing changes

- Detail of each commit with its files and diff, inline or side by side, with an option to ignore whitespace.
- File history (Ctrl+Shift+H): the commits that touched a file, following renames, with each diff and the blame.
- Commit search (Ctrl+F) by message, author, email or SHA; with `file:` in front, by path.
- Command palette (Ctrl+P): any menu action, jump to a branch or open a recent repo.
- Compare a commit with the working directory and view the changes of several commits together.

### What writes to the repo

| Action | Where | What it checks first |
| --- | --- | --- |
| Pull | Pull ▾ button | Goes straight ahead if the branch only moves forward (fast-forward); asks for confirmation if it will merge or rebase |
| Push the current branch | Push button or right-click on its commit | With an upstream it pushes directly; without one it asks for the remote and name. If the remote has commits the branch lacks, it offers Pull or Force Push: the latter lists the commits that would be lost, asks for confirmation and uses `--force-with-lease` |
| Cherry pick one or several commits | Right-click on the commit | Greyed out, with the reason, if the commits are already on the branch |
| Squash consecutive commits | Right-click on the commit | Only commits on the current branch, with no merges and not yet pushed |
| Clone over HTTPS | File ▸ Clone Repo… (Ctrl+N) | Rejects URLs with a user or password written in them |
| Stage and commit | WIP row: stage per file (on hover) or everything; commit box with amend (Ctrl+Enter) | Commits only with something staged and a summary. Amend preloads the message and warns if the commit is already on the remote. Runs the repo's hooks and shows their output if they reject |
| Switch branch | Double-click the branch, in the graph or the left panel | If it is remote, it uses the local branch of the same name (moving it forward if it only lacks commits) or creates one tracking it; refuses if an operation is in progress, if the branch is in another worktree or if uncommitted changes collide |

Each action checks its conditions when the menu opens and again before touching the repo. The other write actions (branches, stash, discard changes) appear greyed out.

### Accounts

The avatar at the top right shows which GitHub account the active tab's repo works with, like the GitKraken profile but per repo: choosing another one saves it to `credential.https://github.com.username` in that repo's `.git/config`, and the terminal uses the same one. The menu tests each account against the remote (has access, requires SSO, no access).

Preferences ▸ Accounts is a visual layer over **Git Credential Manager**: it shows GitHub and Azure DevOps accounts, lets you sign in and out and test the connection. Fluxo does not store tokens.

### Customization

- Five graph designs (Classic, Compact, Large nodes with initials, Rails and Git Graph) and three color sets for labels.
- Your own themes as `.json` files in `%APPDATA%\Fluxo\themes`.
- Highlight a branch's rows when hovering over it in the panel.
- Light and dark theme; Spanish or English (the Windows language by default); date format.
- Panels that widen by dragging their edge, and graph columns chosen from the header.

### Help and diagnostics

- Help ▸ User Guide (F1) and Release Notes, in Spanish and English.
- Help ▸ Git Environment: git version and path, Git Credential Manager, credential helper, proxy (without showing credentials) and SSL backend. If git is missing, this screen opens by itself on startup.
- Help ▸ Error Log (or "View log" on any notice): `%APPDATA%\Fluxo\logs\fluxo.log`, one JSON line per event. Every Fluxo write (checkout, pull, push, commit, stage, cherry pick, squash, fetch) is recorded with its repo, how long it waited and for which operation, how long it took, HEAD and branch before and after, the git commands with their exit codes, the account and whether it was automatic. Errors share the same timeline, and a repeated one is summarized as "repeated N times". Users and tokens appearing in a URL are masked before being written.
- Writes to the same repo are queued, one at a time: a Pull and a branch switch never run at once.

## Install

Download `Fluxo Setup 0.1.0.exe` and run it. It installs per user in `%LOCALAPPDATA%\Programs\Fluxo`, without administrator rights, and creates desktop and Start menu shortcuts.

The installer is not signed: Windows SmartScreen shows a warning the first time. To continue: **More info ▸ Run anyway**.

Requirements:

- 64-bit Windows 10 or 11.
- [Git for Windows](https://git-scm.com/download/win) 2.40 or later, which includes Git Credential Manager.

## Build from source

You also need Node.js 20 or later.

```powershell
git clone https://github.com/jhovannyLinares/Fluxo.git
cd Fluxo
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Opens the app with hot reload |
| `npm test` | Unit and integration tests (git must be installed) |
| `npm run bench` | Performance tests: graph load with 100,000 commits, plus watcher latency and CPU (~1.5 min) |
| `npm run typecheck` | Type check |
| `npm run dist` | Builds the installer in `dist/` |

## Architecture

```
renderer (React, no Node) → preload (window.api) → main (validates IPC with zod) → backend in utilityProcess (git)
```

| Folder | Contents |
| --- | --- |
| `src/shared/` | IPC contracts (zod), graph types, texts in both languages, user guide and release notes |
| `src/main/` | Hardened window, menu, IPC router, error log and preferences |
| `src/backend/` | Safe git execution, readers of its output, lane algorithm, repo watcher, providers (GitHub and Azure DevOps) and environment detection |
| `src/renderer/` | Interface; the graph is drawn on a virtualized canvas |
| `tests/` | Unit tests, integration tests against real git repos, and performance tests |
| `build/` | Icon and the script that generates it |

Fluxo uses the system's installed git through the command line, so it respects each user's configuration, credentials and proxy.

## Security

- The window runs with `contextIsolation`, sandbox, a strict CSP and no navigation.
- Each IPC message is validated twice (in main and in the backend), and so are the responses.
- git runs without a shell and with arguments in an array: a branch name containing `;`, `$()` or quotes executes nothing.
- Fixed variables: `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0`, so that reading does not block an agent that is writing; `core.fsmonitor=false`, so an untrusted repo's configuration cannot run commands.
- Opening in VS Code or the terminal does not pass the path through the command line.

## Measured performance

| Measure | Target | Result |
| --- | --- | --- |
| First graph page (2,000 commits of a 100,000-commit repo) | immediate | 0.52 s |
| Full history of 100,000 commits (git log + lanes) | background | 1.23 s |
| Idle CPU with one repo open | < 1 % | 0.15 % |
| Edit or commit → graph updated (median) | < 2 s | 0.37–0.84 s |

If `fs.watch` stops reporting, Fluxo detects it (it compares the refs and HEAD fingerprint every 30 s) and falls back to polling.

## Known limitations

- Windows only.
- Not tested behind a corporate proxy or certificate. If git uses the `openssl` SSL backend, it does not pick up Windows certificates; change it with `git config --global http.sslBackend schannel`.
- Azure DevOps addresses (PRs, accounts and "Open on the web") are being confirmed during the beta.

## License

[MIT](LICENSE)
