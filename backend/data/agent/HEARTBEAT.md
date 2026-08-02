---
tasks: []
---

# Heartbeat Tasks

These tasks are executed proactively by the Agent on the defined schedule.
Each task's `action` is processed as a natural language request through the Agent pipeline.

## Task Design Guidelines
- Keep actions simple and focused
- Use `enabled: false` for tasks that are not yet ready
- Schedule format: standard cron (minute hour day month weekday), matched against server local time
- Supported syntax per field: `*`, numbers, lists `a,b,c`, ranges `a-b`, steps `*/n` / `a-b/n`; weekday 0 and 7 both mean Sunday
