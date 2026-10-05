# picprep-mcp

Connects any MCP assistant (Claude Code, Codex, Cursor, Antigravity, Gemini CLI, VS Code, Devin CLI, OpenCode and
others) to the [PicPrep](https://getpicprep.com) desktop app on your computer.

```sh
npx -y picprep-mcp          # what the assistant runs (MCP over stdio)
npx -y picprep-mcp --check  # is PicPrep found and running?
```

In an assistant's MCP settings: command `npx`, arguments `-y picprep-mcp`. Setup for each assistant, plugins and
skills: https://github.com/picprep/picprep-agents

It finds the running app through the app's own state file, starts the installed app when a tool is called and it is
not running, and passes every message to the app over `127.0.0.1`. The tools come from the app, so this package does
not change when PicPrep's tools do. No dependencies; Node 18 or newer.

Environment: `PICPREP_APP` (the app's executable, when it is not where its installer puts it), `PICPREP_HOME`
(the app's user folder, when the app is run with a different one). The older `PHOTOPREP_APP` and `PHOTOPREP_HOME`
still work.

MIT licence. PicPrep itself is a separate, commercial app.
