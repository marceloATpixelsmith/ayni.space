# Codex Branching Rules

When making changes to this repository:

## REQUIRED

- Always create new branches from the latest `origin/master`
- Before creating a branch, fetch and reset to latest master
- Never base a branch on a previous Codex branch
- Never reuse an old branch
- Never stack PRs

## Workflow

Before making any change:

1. Fetch latest remote:
   git fetch origin

2. Reset local master to remote:
   git checkout master
   git reset --hard origin/master

3. Create a new branch:
   git checkout -b codex/<short-description>

4. Make changes and commit

## FORBIDDEN

- Do NOT create branches from stale state
- Do NOT branch from another codex/*
- Do NOT skip fetch/reset
- Do NOT attempt to fix conflicts in PRs

## Goal

Every PR must:
- be based on the latest master
- require zero conflict resolution
- merge cleanly via rebase
