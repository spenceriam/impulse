# project_validate

Detect project validation commands.

## Use when

- You need to know the likely typecheck/test/build/lint commands.
- You want to avoid rediscovering project verification commands.

## Parameters

- `cwd` optional string — directory to inspect; defaults to the current working directory.

## Notes

- This is read-only. It lists commands; use `bash` to run one.
- Detection currently reads `package.json` scripts and chooses Bun when `bun.lock`/`bun.lockb` is present.
