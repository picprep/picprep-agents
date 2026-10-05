# Gemini CLI

**Extension (connector and skills together):**

```sh
gemini extensions install https://github.com/picprep/picprep-agents
```

The extension is `gemini-extension.json` at the root of this repository; it runs `npx -y picprep-mcp` and brings the
skills in `skills/`.

**Connector only:** in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "picprep": { "command": "npx", "args": ["-y", "picprep-mcp"] }
  }
}
```
