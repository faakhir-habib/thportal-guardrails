# Backend

All backend work follows the rules in `.claude/guardrails/rules/backend-rules.md`, which the root
`CLAUDE.md` imports — so they are already in context. Before writing a new controller, service,
repository, DTO, EF configuration, migration or test, open the golden example named there for that
layer and copy its shape.

Two facts that catch people out, both verified in this solution:

- There are no EF global query filters, so every soft-delete filter is written by hand in the query.
- A new `IEntityTypeConfiguration<T>` does nothing until it is registered by hand in
  `RepositoryContext.OnModelCreating`.
