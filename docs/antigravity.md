# Google Antigravity

Add to `~/.gemini/config/mcp_config.json` (every workspace) or `.agents/mcp_config.json` (one workspace), or through
the agent panel's MCP servers → Manage → View raw config:

```json
{
  "mcpServers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```

Skills: copy the folders under `skills/` into `~/.gemini/config/skills/` (every workspace) or `.agents/skills/` (one
workspace). The Antigravity CLI reads `~/.gemini/antigravity-cli/skills/` for every workspace.
