# Cross-Platform Shell Compatibility

This document describes impulse's approach to cross-platform shell command execution and how it handles differences between Windows PowerShell, macOS shells, and Linux shells.

## Design Philosophy

impulse is designed to **"just work"** across all major operating systems without requiring developers to write platform-specific commands. The system automatically:

1. **Detects** the host shell and version at runtime
2. **Translates** POSIX commands to native equivalents when needed
3. **Merges** output streams appropriately for each platform
4. **Guides** the AI model with platform-specific command syntax

## Supported Platforms

### Windows
- **PowerShell 5.x** (Windows PowerShell) - Built into Windows 10/11
- **PowerShell 7.x** (pwsh) - Cross-platform PowerShell

### macOS
- **bash** - Legacy default shell (macOS 10.14 and earlier)
- **zsh** - Default shell (macOS 10.15 Catalina and later)
- **fish** - Alternative modern shell (user-installed)

### Linux
- **bash** - Most common default shell
- **zsh** - Popular alternative
- **fish** - Modern user-friendly shell
- **sh** - POSIX-compliant minimal shell

## How It Works

### 1. Shell Detection (`src/util/shell-env.ts`)

On startup or when generating system prompts, impulse:

1. Detects the operating system (`process.platform`)
2. Queries the shell version:
   - **Windows**: Attempts `pwsh --version`, falls back to `powershell.exe`
   - **macOS/Linux**: Reads `$SHELL` environment variable and queries version
3. Returns a `ShellEnvironment` object with:
   - Platform name
   - Shell type and version
   - Command chaining support
   - Platform-specific tips and recommendations

### 2. POSIX-to-PowerShell Translation (`src/tools/posix-translation.ts`)

When running commands on Windows, common POSIX patterns are automatically translated:

| POSIX Command | PowerShell Equivalent |
|---------------|----------------------|
| `mkdir -p a b` | `New-Item -ItemType Directory -Force -Path a, b` |
| `rm -rf x` | `Remove-Item -Recurse -Force x` |
| `ls -la` | `Get-ChildItem -Force` |
| `cat file.txt` | `Get-Content -Path file.txt` |
| `head -n 10 file` | `Get-Content -TotalCount 10 -Path file` |
| `tail -n 10 file` | `Get-Content -Tail 10 -Path file` |
| `grep -r pattern` | `Select-String -Pattern pattern -Recurse` |
| `which cmd` | `Get-Command -Name cmd` |
| `wc -l file` | `(Get-Content -Path file).Count` |
| `echo text` | `Write-Host text` |
| `pwd` | `Get-Location` |
| `env` | `Get-ChildItem Env:` |
| `touch file` | `New-Item -ItemType File -Force -Path file` |
| `cp -r src dst` | `Copy-Item -Recurse -Path src -Destination dst` |
| `mv src dst` | `Move-Item -Path src -Destination dst` |

**Translation happens automatically** - AI models can write POSIX commands and they'll work on Windows.

### 3. Output Stream Handling (`src/tools/bash.ts`)

Different platforms handle command output differently:

#### Windows PowerShell
- Commands return **objects**, not text
- 6 output streams: Output, Error, Warning, Verbose, Debug, Information
- **Solution**: Wrap all commands with `*>&1 | Out-String`
  - `*>&1` merges all streams to stdout
  - `| Out-String` converts objects to readable text

#### macOS/Linux bash/zsh
- Commands return **text** by default
- 2 main streams: stdout (1) and stderr (2)
- **Solution**: Intelligently merge streams
  - Show stdout first (primary output)
  - If stderr exists, append as `[stderr]` section
  - Preserve distinction for debugging

#### fish shell
- Similar to bash/zsh but with different syntax
- Uses `and` / `or` instead of `&&` / `||`
- **Solution**: Detect fish and adjust command separator

### 4. System Prompt Integration (`src/agent/prompts.ts`)

The AI model receives platform-specific guidance in every system prompt:

```markdown
Operating system: macOS
Shell: zsh 5.9 (zsh)

IMPORTANT: Shell command syntax:
- Use && to chain commands (runs next only if previous succeeds)
- Use || for OR logic (runs next only if previous fails)
- Use ; to run commands unconditionally
- zsh is POSIX-compatible with bash-like syntax
- Enhanced globbing available with setopt
```

This helps the model:
- Choose correct command syntax
- Avoid platform-specific mistakes
- Use appropriate flags and options

## Command Chaining

Different shells support different chaining operators:

| Shell | Conditional AND | Conditional OR | Unconditional |
|-------|-----------------|----------------|---------------|
| PowerShell 5.x | ❌ (use `;`) | ❌ (use `;`) | `;` |
| PowerShell 7.x | `&&` | `\|\|` | `;` |
| bash | `&&` | `\|\|` | `;` |
| zsh | `&&` | `\|\|` | `;` |
| fish | `and` | `or` | `;` |
| sh | `&&` | `\|\|` | `;` |

impulse provides `supportsChainedCommands` and `commandSeparator` in `ShellEnvironment` to guide command construction.

## Edge Cases and Solutions

### PowerShell 5.x without && support
**Problem**: Model tries to use `cmd1 && cmd2`  
**Solution**: System prompt warns to use `;` instead, or upgrade to PowerShell 7

### Silent/Empty Output on Windows
**Problem**: Commands like `Get-ChildItem` return nothing  
**Solution**: Automatic `| Out-String` wrapper converts objects to text

### fish shell syntax differences
**Problem**: fish uses `and`/`or` instead of `&&`/`||`  
**Solution**: Detection warns model about fish syntax differences

### Mixed stdout/stderr on Linux
**Problem**: Error messages mixed with normal output  
**Solution**: Separate stderr as `[stderr]` section for clarity

## Adding Support for New Shells

To add support for a new shell:

1. **Add version detection** in `src/util/shell-env.ts`:
   ```typescript
   async function detectNewShellVersion(): Promise<string | null> {
     // Query shell version
   }
   ```

2. **Update `detectUnixShellType()`** to recognize the shell from `$SHELL`

3. **Add shell-specific tips** in `detectShellEnvironment()`

4. **Update system prompt generation** in `generateShellContext()` with syntax guidance

5. **Test on target platform** to verify detection and command execution

## Testing

### Manual Testing
```bash
# Windows PowerShell 5.x
impulse
> Run: Get-ChildItem

# Windows PowerShell 7
impulse
> Run: ls | Select-Object Name

# macOS zsh
impulse
> Run: ls -la && echo "success"

# Linux bash
impulse
> Run: cat /etc/os-release

# fish shell
impulse
> Run: echo "test" and echo "worked"
```

### Automated Testing
See `test/` directory for cross-platform test suites.

## Best Practices for AI Models

When running commands through impulse:

1. **Use POSIX syntax on Windows** - Translation happens automatically
2. **Trust the system prompt** - Shell-specific guidance is accurate
3. **Avoid shell-specific features** - Stick to common commands when possible
4. **Check exit codes** - All platforms support `exitCode` in tool results
5. **Read stderr separately** - macOS/Linux results include `[stderr]` section

## Future Enhancements

Potential improvements:

- [ ] Windows batch file (`.bat`) support
- [ ] Shell profile detection (`.bashrc`, `.zshrc`, etc.)
- [ ] Custom shell alias detection
- [ ] Interactive command prompts (sudo, SSH, etc.)
- [ ] Real-time streaming for long-running commands
- [ ] Shell-specific linting and suggestions

## References

- [PowerShell Documentation](https://docs.microsoft.com/en-us/powershell/)
- [Bash Manual](https://www.gnu.org/software/bash/manual/)
- [Zsh Documentation](https://zsh.sourceforge.io/Doc/)
- [Fish Shell Documentation](https://fishshell.com/docs/current/)
