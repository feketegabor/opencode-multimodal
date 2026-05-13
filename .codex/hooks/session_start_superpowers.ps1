$ErrorActionPreference = "Stop"

$context = "Superpowers: follow superpowers workflows; main sessions start with superpowers:using-superpowers; dispatched subagents skip it and use task-relevant skills."

@{
  hookSpecificOutput = @{
    hookEventName = "SessionStart"
    additionalContext = $context
  }
} | ConvertTo-Json -Depth 10 -Compress
