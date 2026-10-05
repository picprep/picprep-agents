# Cline

Cline panel → MCP Servers → Configure → Configure MCP Servers, which opens Cline's MCP settings file (the Cline CLI
reads `~/.cline/mcp.json`):

```json
{
  "mcpServers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"], "disabled": false }
  }
}
```
