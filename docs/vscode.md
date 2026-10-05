# VS Code (GitHub Copilot agent mode)

The command palette's "MCP: Add Server" walks through it. By hand there are two formats.

**`.mcp.json`** at the root of a workspace, or `~/.copilot/mcp-config.json` for every workspace (the format other
Copilot tools read too); its key is `mcpServers`:

```json
{
  "mcpServers": {
    "picprep": { "type": "stdio", "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```

**`.vscode/mcp.json`** in a workspace, or the user `mcp.json` (command palette: "MCP: Open User Configuration"), VS
Code's own older format. It needs `"type": "stdio"`, and its key is `servers`, not `mcpServers`:

```json
{
  "servers": {
    "picprep": { "type": "stdio", "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```

Or: `code --add-mcp '{"name":"picprep","type":"stdio","command":"npx","args":["-y","picprep-mcp"]}'`.
Skills: copy the folders under `skills/` into a workspace's `.github/skills/` or `.agents/skills/`, or into
`~/.copilot/skills/` or `~/.agents/skills/` for every workspace.
