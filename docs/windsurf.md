# Devin Desktop (formerly Windsurf)

Devin Desktop reads `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json` on Windows). Open it from
the Cascade panel: the `...` menu, then "Open MCP config file". Add:

```json
{
  "mcpServers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```

The Devin Local agent (the default for new tabs) uses the Devin CLI's settings: set it up as for the Devin CLI. A
Windsurf from before the move to Devin Desktop kept the same content in `~/.codeium/windsurf/mcp_config.json`.
