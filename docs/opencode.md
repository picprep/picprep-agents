# OpenCode

In `opencode.json` (a project) or `~/.config/opencode/opencode.json` (every project). OpenCode's key is `mcp`, and
the command is one array:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "picprep": { "type": "local", "command": ["npx", "-y", "picprep-mcp"], "enabled": true }
  }
}
```

Skills: copy the folders under `skills/` into `~/.config/opencode/skills/` or `~/.agents/skills/` (or a project's
`.opencode/skills/` or `.agents/skills/`).
