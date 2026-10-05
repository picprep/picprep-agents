# Publishing

How this repository goes public and `picprep-mcp` reaches npm, as numbered steps for the maintainer, done when
PicPrep 1.0.0 is released. Nothing here has been done: the repository is private, `picprep-mcp` is free on npm
(checked 2026-10-05), and no directory has been told about it. Each step says whether it can be taken back.

## What is ready

- `picprep-mcp` **1.0.0** (`packages/picprep-mcp`), every manifest and `server.json` at 1.0.0 (`test/plugin.js`
  fails until they agree). `mcpName`: `io.github.picprep/picprep-mcp`.
- `npm pack --dry-run`: exactly `LICENSE`, `README.md`, `bin/picprep-mcp.js`, `bridge.js`, `package.json`
  (9.8 kB packed, 27.2 kB unpacked).
- `picprep.mcpb` (`npm run build:mcpb`): `manifest.json`, `icon.png`, `server/index.js`, `server/bridge.js`,
  `server/package.json`, `server/LICENSE`. Built and unpacked on 2026-10-05, its `server/index.js` answered
  initialize, listed the 11 tools and called two of them against the app of `release-fixes`.
- The skills, tool list and texts match the app's `release-fixes` branch: `PICPREP_SRC=<that checkout> npm test`
  passes (bridge, plugin, names, parity).
- A fresh history: the local branch `public-main` is ONE commit of this tree, authored
  `Tal Afek <noreply@getpicprep.com>`, never pushed. It is rebuilt from `main` with the commands in step 2 whenever
  `main` moves.

## The steps

**0. Checks** (reversible). With the app checkout of the release beside this repo:

```sh
PICPREP_SRC=../picprep npm test
(cd packages/picprep-mcp && npm pack --dry-run)       # the five files above
npm run build:mcpb                                    # dist/picprep.mcpb
```

**1. An npm account** (reversible). `npm whoami` on this computer answers 401 Unauthorized: the token in
`~/.npmrc` is no longer accepted, so nobody is logged in. Needed: the npm account that will own `picprep-mcp` (an
npm organisation `picprep` is optional; the unscoped name needs none), two-factor authentication on, then
`npm login` on this computer (it replaces the old token).

**2. Replace the private history with the fresh one** (cannot be taken back once step 3 is done). Rebuild
`public-main` from the current `main`, check it, and replace `main` on GitHub:

```sh
git checkout --orphan public-new main && git commit -q -m "PicPrep for assistants: the picprep-mcp connector, skills and setups" \
  && git branch -M public-new public-main && git checkout main
git log --format='%an <%ae>' public-main          # one line: Tal Afek <noreply@getpicprep.com>
git diff main public-main --stat                  # empty: the same tree
git push --force origin public-main:main          # the private repo's main is now the one commit
git fetch origin && git checkout main && git reset --hard origin/main && git branch -D public-main
```

The private repository has no other branch, tag, release or pull request (checked 2026-10-05), so nothing else
points at the old commits. GitHub may still serve an old commit to someone who already knows its full hash; the
airtight alternative is a new repository (`picprep/picprep-agents` deleted and created again, then
`git push origin public-main:main`), which also drops the old Actions logs. Either way, do it before step 3.

**3. Make the repository public** (in practice cannot be taken back: clones and caches stay). GitHub:
`picprep/picprep-agents` → Settings → General → Danger Zone → Change visibility → Public. Then About: description,
website `https://getpicprep.com`, topics `mcp`, `mcp-server`, `gemini-cli-extension`; Issues on; check the
`ci` workflow ran green (three systems, Node 18).

**4. Publish `picprep-mcp` 1.0.0 to npm by hand** (cannot be taken back: a version is permanent, and an unpublished
name is blocked for 24 hours). npm takes a trusted publisher only for a package that exists, so the first version is
manual and carries no provenance:

```sh
cd packages/picprep-mcp && npm publish --access public    # asks for the two-factor code
cd /tmp && npx -y picprep-mcp --version                   # 1.0.0
npx -y picprep-mcp --check
```

**5. Trusted publishing for later versions** (reversible). npmjs.com → `picprep-mcp` → Settings → Trusted
Publisher → GitHub Actions: organisation `picprep`, repository `picprep-agents`, workflow `release.yml`, no
environment; under allowed actions tick `npm publish` (new publishers otherwise only stage). Then Publishing access
→ "Require two-factor authentication and disallow tokens". From then a release is: bump the version in
`packages/picprep-mcp/package.json`, `server.json` and every manifest, push, publish a GitHub Release
`v<version>`; `.github/workflows/release.yml` tests, builds and attaches the bundle, and publishes with provenance.

**6. GitHub Release `v1.0.0` with the bundle** (reversible: a release can be deleted). Releases → Draft a new
release → tag `v1.0.0` on `main` → Publish. The workflow attaches `picprep.mcpb` and skips npm (1.0.0 is
there). `docs/claude-desktop.md` sends people to the latest release, so this comes before the site flip. Try it
once by hand in Claude Desktop.

**7. MCP Registry** (reversible: an entry can be marked deleted; its name stays taken). Install `mcp-publisher`
(the registry's releases), then from `packages/picprep-mcp`:

```sh
mcp-publisher validate                      # server.json against the current schema, if this version has it
mcp-publisher login github                  # as a member of the picprep organisation (io.github.picprep/...)
mcp-publisher publish
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.picprep/picprep-mcp"
```

The registry checks `mcpName` in the published npm package (it is in 1.0.0). Not tried: `server.json`'s
`subfolder` field and the 100-character description limit were not confirmed against the schema.

**8. The site flip** (reversible). In the site repository (`picprep-site`): `CONNECTOR_PUBLISHED = true` in
`build.mjs` (the setup guide stops saying "Available at launch"), `node scripts/sync-vendor.mjs` so it quotes
these notes as they are, `node build.mjs --vendor`, commit; deploying is its own decision. Then try each
one-command install against the public repository (`claude plugin marketplace add picprep/picprep-agents`,
`codex plugin marketplace add picprep/picprep-agents`,
`gemini extensions install https://github.com/picprep/picprep-agents`, the Cursor link): none could be tried
while it was private.

**Afterwards, in the app** (`picprep`, task T059 of `specs/005-licensing-distribution/tasks.md`): remove
`skills/`, `.claude-plugin/` and their `files` and test entries, and update its `CLAUDE.md` "The plugin". The
skills here are then the only copies; `scripts/sync-skills.js` and the comparison in `test/plugin.js` go.

## Directories worth a listing (after step 8)

All optional, each can be withdrawn. Requirements were read on 2026-10-04 where it says so; the rest are from
memory and need checking on the day.

| Where | What it needs | Checked |
|---|---|---|
| **MCP Registry** (registry.modelcontextprotocol.io), which other catalogues read | `mcpName` in the published package (there), `packages/picprep-mcp/server.json` (there; confirm it against the current schema with `mcp-publisher init`), then `mcp-publisher login github` as a member of the `picprep` organisation and `mcp-publisher publish` | 2026-10-04, the registry's quickstart; `server.json`'s `subfolder` field and the 100-character description limit were not |
| **Gemini CLI extensions gallery** | public repository, `gemini-extension.json` at its root (there), the topic `gemini-cli-extension`; a crawler lists it | 2026-10-04 |
| **Claude Code** | nothing to submit: the repository is its own marketplace (`.claude-plugin/marketplace.json`). Anthropic's own directory takes submissions through a form | marketplace format 2026-10-04; the form not |
| **Claude Desktop extensions directory** | the `.mcpb`, a privacy policy address, tool annotations (the app's tools have them), a submission form | no |
| **Codex plugin directory** | more than the manifest has now: `interface.shortDescription` of at most 30 characters (it is 48), `longDescription`, `capabilities`, `composerIcon` and `logo` images, support, privacy and terms addresses. The current format also prefers a `plugin.json` at the repository root; `.codex-plugin/plugin.json`, as here, is still read | 2026-10-04 |
| **Cursor** MCP directory | a submission with name, description, the install link from `docs/cursor.md` and a logo | no |
| **Cline** MCP marketplace | an issue in its marketplace repository with the repository address and a 400 by 400 logo | no |
| PulseMCP, Glama, Smithery, mcp.so | community catalogues; most pick a server up from the MCP Registry or a short form | no |

Every listing's text must say what the README says and no more: a desktop app is required, nothing leaves the
computer, and the assistant cannot keep its own changes, approve, export, delete or change settings.

## The assistants' notes: what was checked

`docs/*.md` were compared with each assistant's own documentation on 2026-10-04.

- **Confirmed as written**: Antigravity, Gemini CLI, Goose, oh-my-pi, OpenCode; Cursor (paths, key, skills folders
  and the install link; Cursor's own field table calls `"type": "stdio"` required while its examples leave it out,
  as the note does).
- **Corrected that day, then matching**: Claude Code (the Windows `cmd /c npx` line is gone from its documentation and
  was removed), Claude Desktop (skills are under Customize → Skills), Cline (the tab is Configure; the settings file's
  name is no longer documented), Devin CLI (`-s user` for every project), VS Code (the portable `.mcp.json` format
  added; that it takes `"type": "stdio"` is not stated in so many words), Devin Desktop, formerly Windsurf (new file
  location), Zed (how to reach the settings).
- **Codex**: commands, `config.toml` and skills folders confirmed; the plugin manifest is the older of two formats
  (see the table).
- **Not tried in any assistant**: every note was checked against documentation, none by installing in that
  assistant. The connector itself was driven over stdio against the running app.
