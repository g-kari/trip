---
name: review
description: Codex CLIで未コミットの変更をコードレビューする。コミット前のレビューに使用。
disable-model-invocation: true
---

# Review Changes with Codex

Run codex to review uncommitted changes before committing.

## Instructions

Execute the following command and show the output to the user:

```bash
codex review --uncommitted "Check for bugs, security issues, and code quality problems. Be concise."
```

If there are no uncommitted changes, inform the user.
