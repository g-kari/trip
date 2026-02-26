# Codex Review Skill

Use this skill to get a code review from OpenAI Codex CLI.

## Usage

`/codex-review [file or description]`

## Instructions

When invoked, run the codex CLI to review the specified code or recent changes.

### For specific files:
```bash
codex "Review this file for bugs, security issues, and improvements: $(cat <filepath>)"
```

### For recent changes (default):
```bash
git diff HEAD~1 | codex "Review this git diff for bugs, security issues, code quality, and suggest improvements"
```

### For staged changes:
```bash
git diff --staged | codex "Review these staged changes for bugs and improvements"
```

## Examples

- `/codex-review src/worker.ts` - Review a specific file
- `/codex-review` - Review the most recent commit's changes
- `/codex-review staged` - Review staged changes

## Output

Summarize the key findings from codex's review:
1. Security issues (if any)
2. Bugs or potential bugs
3. Code quality improvements
4. Performance suggestions
