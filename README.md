# PicPrep for assistants

Connect your assistant to [PicPrep](https://getpicprep.com), the desktop app that prepares photos for posting. With
it, an assistant can open your projects, look at them, ask you questions in the app and make changes. Each change is
applied by PicPrep, marked as the assistant's with its reason, and waits for you to keep or reject it. The judgement
stays yours: the assistant cannot keep its own changes, answer its own questions, approve a slide, export, delete or
change your settings.

This repository holds:

- **`picprep-mcp`** (`packages/picprep-mcp/`), the connector: a small program any MCP assistant runs as a local
  command (`npx -y picprep-mcp`). It finds PicPrep on your computer, starts it when it is not running, and passes
  messages between the assistant and the app. No dependencies.
- **Skills** (`skills/`), in the open Agent Skills format (`SKILL.md`): how to use each PicPrep stage well.
- **Plugins and settings** for each assistant, below.

You need PicPrep installed, and Node.js 18 or newer for `npx` (Claude Desktop's one-click bundle needs neither Node
nor npx).

## Set up your assistant

| Assistant | How |
|---|---|
| Claude Code | Plugin: `claude plugin marketplace add picprep/picprep-agents` - [docs/claude-code.md](docs/claude-code.md) |
| Claude Desktop | One-click `picprep.mcpb` - [docs/claude-desktop.md](docs/claude-desktop.md) |
| OpenAI Codex | Plugin: `codex plugin marketplace add picprep/picprep-agents` - [docs/codex.md](docs/codex.md) |
| Cursor | Install link - [docs/cursor.md](docs/cursor.md) |
| Google Antigravity | [docs/antigravity.md](docs/antigravity.md) |
| Gemini CLI | Extension: `gemini extensions install https://github.com/picprep/picprep-agents` - [docs/gemini-cli.md](docs/gemini-cli.md) |
| VS Code (Copilot) | [docs/vscode.md](docs/vscode.md) |
| Devin CLI (local only) | [docs/devin-cli.md](docs/devin-cli.md) |
| OpenCode | [docs/opencode.md](docs/opencode.md) |
| oh-my-pi | [docs/oh-my-pi.md](docs/oh-my-pi.md) |
| Devin Desktop (formerly Windsurf) | [docs/windsurf.md](docs/windsurf.md) |
| Zed | [docs/zed.md](docs/zed.md) |
| Cline | [docs/cline.md](docs/cline.md) |
| Goose | [docs/goose.md](docs/goose.md) |
| Anything else | Any assistant that runs a local MCP server: command `npx`, arguments `-y picprep-mcp`. |

## The tools

PicPrep gives an assistant eleven tools. They come from the app each time it runs, so this list is a description, not
a definition: the app's own descriptions and schemas are what the assistant sees.

| Tool | What it does |
|---|---|
| `list_projects` | The projects, newest first. |
| `open_project` | Shows a project in your window, by name or from a folder of photos. |
| `view` | Reads: the project, what you said and marked (and why it made each change), a tab, the history, presets and your watermarks, templates, the list of changes it may make. |
| `view_screenshot` | A picture of a slide, a tab or the window, for looks only. |
| `show_tab` | Points you at a tab, a slide or a question. It only navigates. |
| `ask` | Asks you what only you can judge, instead of guessing; you answer in your own words, when you like. |
| `choose` | Offers you options to pick from. |
| `propose` | Changes the project through PicPrep's named operations (what a button, key or drag does). Applied at once, marked as the assistant's; a few, like deleting, are only offered for you to do. |
| `get_outcome` | Reads what you did: your answer, or whether you kept, rejected or commented on a change. |
| `withdraw` | Takes back its own open question, or its changes you have not reviewed yet. |
| `status` | Shows in your window that it is at work, from before its first change until it is done. Nothing in the project changes. |

## How it works

```
assistant ──stdio──> picprep-mcp ──HTTP, 127.0.0.1 only──> PicPrep app (POST /mcp)
```

1. The app writes its port and a random session token to `state/server.json` in its user folder each time it starts
   (macOS `~/Library/Application Support/picprep`, Windows `%APPDATA%\picprep`, Linux
   `~/.config/picprep`). A copy from before the rename from PhotoPrep keeps it in a folder called `photoprep`
   until the app has started once since; the connector reads it there.
2. `picprep-mcp` reads that file, checks the app answers on `/health`, and sends each message to the app's `/mcp`
   with the token. The tools, their descriptions and the instructions all come from the app, so a new PicPrep version
   brings its tools with it, with no connector update.
3. When the app is not running, the connector answers the assistant's opening handshake with the tool list the app
   gave last time (kept in `state/mcp-catalogue.json`), and starts the app only when a tool is actually called - so
   opening your editor does not open PicPrep. If the app was updated since, the assistant is told the tool list
   changed.
4. A PicPrep with no subscription or trial still answers the tools that only look; the others reply that only you
   can enter a licence, in Settings.

Where it starts the app from: macOS, the installed app (by its bundle id); Windows,
`%LOCALAPPDATA%\picprep\picprep.exe`; Linux, `/usr/bin/picprep` (the .deb) or `picprep` on your `PATH`.
Elsewhere, set `PICPREP_APP` to the app's executable in the assistant's server settings.

Nothing leaves your computer: the connector talks only to `127.0.0.1`, and it writes one file (the tool-list cache).

## When it does not connect

Run `npx -y picprep-mcp --check`. It says where it looks, whether PicPrep is running, and what it would start.
The assistant is told in plain words too, and can tell you:

- **PicPrep is not installed, or did not start**: "PicPrep is not installed on this computer (looked for ...). Install
  it, open it once, then try again.", or that it was started but did not answer within 30 seconds.
- **No project is open**: "no PicPrep window has a project open ... Pass project (name or id)", with the projects
  there are. The assistant can open one for you.
- **No subscription or trial**: PicPrep still shows every project, and the tools that only look still answer. The
  ones that change something answer "PicPrep needs a subscription or an active trial (...). Only the person can enter
  one, in Settings → Licence."

## Developing

```sh
npm test                     # plain Node, no packages
npm run build:mcpb           # dist/picprep.mcpb
node scripts/sync-skills.js  # copy skills/ from a checkout of the app next to this one
node test/parity.js --write  # record the app's tools again after they changed
node eval/eval.js labels     # the assistant eval's tasks and labels (EVAL.md says how it was run, and what it cost)
```

`test/bridge.js` runs the connector against a fake app (`test/lib/fake-app.js`) in a throwaway user folder; it never
starts or touches a real PicPrep. `test/plugin.js` checks every manifest, skill and snippet, `test/names.js` that
nothing here names a person or a private place, and `test/parity.js` that the tools this page and the skills describe
are the app's.

With a checkout of the app beside this repo (a folder called `picprep`, or `PICPREP_SRC`), the tests also compare
with the app itself: the connector's user folder is the app's on every OS, `skills/` matches the app's, and the
connector is run against the app's real server (no window, a throwaway user folder): it must list the app's tools
unchanged, every tool is called once, and each refusal a new user meets must be a plain sentence. Without the
checkout those checks say they were skipped. The app's source is not public; PicPrep's maintainers run them.

A skill describes tools the app serves: when a PicPrep release changes a tool, the skill that drives it changes in
the same release. Every manifest (`.claude-plugin/`, `.codex-plugin/`, `gemini-extension.json`, `mcpb/manifest.json`)
and `packages/picprep-mcp/server.json` carries the `picprep-mcp` version; bump them together. [PUBLISHING.md](PUBLISHING.md)
says how a release goes out.

## Licence

MIT. PicPrep itself is a separate, commercial app.
