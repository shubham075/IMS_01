# Idea_01 — project instructions

- **Finance / tax / accounting / pricing / fundraising questions** → invoke the `india-senior-ca-finance-controller` skill.
- **Legal / compliance / policies / contracts / privacy questions** → invoke the `india-legal-helper-senior-advisor` skill.
- Use both when a question spans the two. Both read `.claude/finance-legal-context.md` first; update it when the user confirms a new fact.
- Design docs index: `docs/README.md`. Load only the file needed; refer to items by ID (FR-xx, D-xx, S3…) instead of pasting text.
- Ask clarifying questions before starting work. Finish design and edge cases before code.
