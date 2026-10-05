# Claude Code

**Plugin (connector and skills together):**

```sh
claude plugin marketplace add picprep/picprep-agents
claude plugin install picprep@picprep
```

Inside a session the same is `/plugin marketplace add picprep/picprep-agents`, then `/plugin install picprep@picprep`
(it opens the plugin's page, where you confirm).
The plugin runs `npx -y picprep-mcp` and adds the five PicPrep skills.

**Connector only:**

```sh
claude mcp add picprep -- npx -y picprep-mcp
```

Check the connection with `/mcp` in a session, or `npx -y picprep-mcp --check` in a terminal.
