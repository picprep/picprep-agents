# Claude Desktop

**One click:** download `picprep.mcpb` from the latest release of this repository and open it; Claude Desktop
asks to install the PicPrep extension (or: Settings → Extensions → Advanced settings → Install Extension). It carries
`picprep-mcp` inside, so nothing else is needed.

**By hand:** Settings → Developer → Edit Config, then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```

Restart Claude Desktop. Skills: zip each folder under `skills/` and upload it in Customize → Skills ("+", Create
skill, Upload a skill).
