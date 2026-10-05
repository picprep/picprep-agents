# Zed

Settings → AI → MCP Servers → Add Server → Add Local Server, or in Zed's `settings.json` (command palette:
`zed: open settings file`). Zed calls MCP servers context servers:

```json
{
  "context_servers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"], "env": {} }
  }
}
```
