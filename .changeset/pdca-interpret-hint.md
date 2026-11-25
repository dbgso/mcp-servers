---
"interactive-pdca-mcp": patch
---

The "Next step" hint on a feedback that has no interpretation yet shows the real task and feedback ids.

It was a plain string rather than a template, so it printed `id: "${taskId}", feedback_id: "${feedbackId}"` literally, and the call it suggested could not be copied as it was. Found by the `no-template-curly-in-string` lint rule.
