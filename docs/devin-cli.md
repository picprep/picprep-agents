# Devin CLI

Local only: a Devin cloud session runs on another machine and cannot reach the PicPrep app on yours. Use the Devin
CLI on the computer where PicPrep is installed.

```sh
devin mcp add -s user picprep -- npx -y picprep-mcp
```

`-s user` adds it for every project; without it the server is added to the current project only, for you alone
(`.devin/mcp_config.local.json`). Or write it in `~/.config/devin/mcp_config.json` (every project) or
`.devin/mcp_config.json` (one project):

```json
{
  "mcpServers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```
