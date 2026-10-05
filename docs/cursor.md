# Cursor

**One click:** [Add PicPrep to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=picprep&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBpY3ByZXAtbWNwIl19)

(`cursor://anysphere.cursor-deeplink/mcp/install?name=picprep&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBpY3ByZXAtbWNwIl19` -
the config is `{"command":"npx","args":["-y","picprep-mcp"]}` in base64.)

**By hand:** `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```

Skills: copy the folders under `skills/` into `~/.cursor/skills/` or `~/.agents/skills/` (or a project's
`.cursor/skills/` or `.agents/skills/`).
