# Codex Hook System

Current project hook config: `.codex/hooks.json`.

## SessionStart

Runs once for every Codex session, including spawned subagent sessions.

- `session_start_superpowers.ps1`
  - Injects a short Superpowers reminder.
  - Main sessions start with `superpowers:using-superpowers`.
  - Dispatched subagents skip that bootstrap skill and use only task-relevant skills.
- `session_start_opensrc.ps1`
  - Injects a dynamic OpenSRC summary from this repo's `opensrc/sources.json`.
  - Reminds agents to activate the task repository in Serena.
  - For OpenSRC work, the task repository is the referenced repo path under `opensrc/`.
- `serena-hooks activate --client=codex`
  - Serena official startup helper.
  - Keeps Serena adoption behavior aligned with Serena's Codex integration.

SessionStart output intentionally enters the model context once per session.

## PreToolUse

Runs before selected tool calls.

- `pre_tool_use_policy.ps1`
  - Matcher: `Shell|Bash|shell_command|functions.shell_command`.
  - Enforces bounded `rg` output and bounded raw file reads for the main agent.
  - Allows full `SKILL.md` reads.
  - Allows broad reference-repo search for explorer subagents when they set `OPENCODE_ALLOW_BROAD_RG=1`.
- `serena-hooks remind --client=codex`
  - Matcher: shell/edit tools only.
  - Serena official short nudge toward symbolic tools where useful.
- `pre_tool_use_chrome.ps1`
  - Matcher: Node REPL only.
  - Blocks the untrusted cached Chrome client path.
  - Nudges agents to use the trusted bundled marketplace client and `agent.browsers.get("extension")`.

PreToolUse hooks should be narrow. They should not run for unrelated MCP calls.
Only deny messages or hook-provided context should affect the model context.

## PostToolUse

Runs after selected shell commands.

- `post_tool_use_opensrc_serena.ps1`
  - Matcher: `Shell|Bash|shell_command|functions.shell_command`.
  - Detects successful `opensrc` usage.
  - Runs `sync_opensrc_serena.ps1`.

`sync_opensrc_serena.ps1` prepares OpenSRC mirrors as Serena projects by:

- detecting project languages from files;
- writing `.serena/project.yml` into each reference repo;
- adding reference repos to Serena's global project registry.

It does not install missing LSPs. Missing LSP support should surface as an explicit Serena failure so the user can decide whether to install it.

## Deliberately Not Used

- No `serena-hooks cleanup` on Codex `Stop`.
  - Codex may run `Stop` after every assistant turn.
  - Serena cleanup deletes per-session hook data, which is too aggressive for this project.
- No broad `*` matchers for normal policy hooks.
  - Broad matchers add noise and can run hooks before unrelated MCP tools.

## Subagents

Spawned agents are separate Codex sessions. Their SessionStart hooks run independently, and their Serena MCP state is isolated from the main session.

For reference-repo research, spawn the subagent with the target repo path in the task. The SessionStart hint tells it to activate that task repository in Serena.
