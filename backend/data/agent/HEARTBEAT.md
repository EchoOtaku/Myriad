---
tasks:
  - id: morning-briefing
    name: "Morning Briefing"
    schedule: "0 9 * * *"
    action: "Summarize today's top 5 important news from Brew subscriptions"
    enabled: false

  - id: brew-monitor
    name: "Subscription Monitor"
    schedule: "0 */6 * * *"
    action: "Check for unread articles in Brew, notify if more than 20"
    enabled: false
---

# Heartbeat Tasks

These tasks are executed proactively by the Agent on the defined schedule.
Each task's `action` is processed as a natural language request through the Agent pipeline.

## Task Design Guidelines
- Keep actions simple and focused
- Use `enabled: false` for tasks that are not yet ready
- Schedule format: standard cron (minute hour day month weekday)
