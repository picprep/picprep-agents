# OpenAI Codex (CLI, app and IDE extension)

**Plugin (connector and skills together):**

```sh
codex plugin marketplace add picprep/picprep-agents
```

then install **PicPrep** from the plugin list (`/plugins` in the CLI). The plugin is `.codex-plugin/plugin.json`, with
the connector in `mcp.json` and the skills in `skills/`.

**Connector only:** `codex mcp add picprep -- npx -y picprep-mcp`, or in `~/.codex/config.toml`:

```toml
[mcp_servers.picprep]
command = "npx"
args = ["-y", "picprep-mcp"]
```

Skills without the plugin: copy the folders under `skills/` into `~/.agents/skills/` (or a project's `.agents/skills/`).
