# Contributing to IMPULSE

Thank you for your interest in contributing to IMPULSE! This document provides guidelines and instructions for contributing.

## Prerequisites

**Bun is required.** IMPULSE uses OpenTUI which depends on `bun:ffi` for terminal rendering. It cannot run on Node.js.

```bash
# Install Bun (macOS, Linux, WSL)
curl -fsSL https://bun.sh/install | bash

# Verify installation
bun --version  # Requires 1.0+
```

## Development Setup

```bash
# Clone the repository
git clone https://github.com/spenceriam/impulse.git
cd impulse

# Install dependencies
bun install

# Run in development mode
bun run dev

# Run type checking
bun run typecheck

# Run tests
bun test
```

## Project Structure

```
impulse/
├── src/
│   ├── index.tsx           # CLI entry point
│   ├── agent/              # GLM agent and subagents
│   ├── api/                # Z.AI API client
│   ├── mcp/                # MCP server integrations
│   ├── session/            # Session management
│   ├── tools/              # Built-in tools
│   ├── ui/                 # OpenTUI components
│   │   ├── components/     # Reusable UI components
│   │   ├── context/        # SolidJS contexts
│   │   └── design.ts       # Design constants
│   └── util/               # Utilities
├── AGENTS.md               # Project brain (architecture, decisions)
├── PRINCIPLES.md           # Non-negotiable rules
└── docs/                   # Documentation
```

## Code Style

- **TypeScript strict mode** - No `any` types
- **Functional components** - Prefer functions over classes
- **Zod for validation** - Runtime type checking
- **No emojis in UI** - Brutalist aesthetic, ASCII only

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `status-line.tsx` |
| Components | PascalCase | `StatusLine` |
| Functions | camelCase | `createSession` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feat/your-feature
# or
git checkout -b fix/your-bugfix
```

### 2. Make Your Changes

- Follow the existing code patterns
- Add tests for new functionality
- Update documentation if needed

### 3. Test Your Changes

```bash
# Type check
bun run typecheck

# Run tests
bun test

# Test the app manually
bun run dev
```

### 4. Commit Your Changes

Use conventional commit format:

```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve issue with X"
git commit -m "docs: update README"
git commit -m "refactor: simplify Y"
```

### 5. Submit a Pull Request

- Push your branch to GitHub
- Open a PR against `main`
- Describe your changes clearly
- Link any related issues

## Reporting Issues

When reporting bugs, please include:

1. **IMPULSE version** (`impulse --version`)
2. **Operating system** and version
3. **Steps to reproduce** the issue
4. **Expected behavior** vs actual behavior
5. **Error messages** or screenshots if applicable

## Key Constraints

### OpenTUI Specifics

- Uses Yoga for flexbox layout (not CSS)
- Never call `process.exit()` directly - use `renderer.destroy()`
- Solid uses underscores for multi-word components: `<tab_select>`, `<ascii_font>`
- Text styling requires nested tags: `<strong>`, `<em>`, `<span fg="...">`

### GLM API Specifics

- Endpoint: `https://api.z.ai/api/coding/paas/v4/`
- `tool_stream=true` required for streaming tool output
- Tool arguments may contain `null` - strip before Zod validation

## Areas for Contribution

- Bug fixes and performance improvements
- New tools for the agent
- Documentation improvements
- Test coverage
- Accessibility improvements

## Questions?

- Check [AGENTS.md](AGENTS.md) for architecture details
- Open an issue for discussion
- Tag `@spencer_i_am` for urgent matters

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
