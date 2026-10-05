# oh-my-pi (omp)

In `~/.omp/agent/mcp.json` (every project) or `.omp/mcp.json` (one project):

```json
{
  "mcpServers": {
    "picprep": { "type": "stdio", "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```
