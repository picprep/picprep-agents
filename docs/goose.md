# Goose

For one session: `goose session --with-extension "picprep:npx -y picprep-mcp"` (the name before the colon is what
Goose calls the extension; without it the tools are named after `npx`).

To keep it: `goose configure` → Add Extension → Command-line Extension, name `picprep`, command
`npx -y picprep-mcp`. That writes, in `~/.config/goose/config.yaml`:

```yaml
extensions:
  picprep:
    name: picprep
    type: stdio
    cmd: npx
    args: [-y, picprep-mcp]
    enabled: true
    timeout: 300
```
