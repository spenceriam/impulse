/**
 * POSIX-to-PowerShell Command Translation
 * 
 * Automatically translates common POSIX commands to PowerShell equivalents
 * for better Windows compatibility when models emit Linux-style commands.
 */

interface CommandTranslation {
  pattern: RegExp;
  replacement: (match: RegExpMatchArray) => string;
  description: string;
}

/**
 * Translation rules for common POSIX commands
 * 
 * Based on audit feedback from Windows testing session
 */
const TRANSLATIONS: CommandTranslation[] = [
  // mkdir -p (create directory with parents)
  {
    pattern: /^mkdir\s+-p\s+(.+)$/i,
    replacement: (m) => `New-Item -ItemType Directory -Force -Path ${m[1]}`,
    description: "mkdir -p -> New-Item -Force",
  },

  // rm -rf (recursive force delete)
  {
    pattern: /^rm\s+(-[rfivI]+\s+)+(.+)$/,
    replacement: (m) => `Remove-Item -Recurse -Force -Path ${m[2]}`,
    description: "rm -rf -> Remove-Item -Recurse -Force",
  },

  // ls with args -> Get-ChildItem
  {
    pattern: /^ls\s+(-[alhrtSR]+\s+)*(.*)$/,
    replacement: (m) => {
      const path = m[2] || ".";
      const flags = m[1] || "";
      const recurse = flags.includes("R") ? " -Recurse" : "";
      const force = flags.includes("a") ? " -Force" : "";
      return `Get-ChildItem${recurse}${force} -Path ${path}`;
    },
    description: "ls -> Get-ChildItem",
  },

  // cat -> Get-Content
  {
    pattern: /^cat\s+(.+)$/,
    replacement: (m) => `Get-Content -Path ${m[1]}`,
    description: "cat -> Get-Content",
  },

  // head -n X -> Get-Content -TotalCount X
  {
    pattern: /^head\s+-n\s+(\d+)\s+(.+)$/,
    replacement: (m) => `Get-Content -TotalCount ${m[1]} -Path ${m[2]}`,
    description: "head -n -> Get-Content -TotalCount",
  },

  // tail -n X -> Get-Content -Tail X
  {
    pattern: /^tail\s+-n\s+(\d+)\s+(.+)$/,
    replacement: (m) => `Get-Content -Tail ${m[1]} -Path ${m[2]}`,
    description: "tail -n -> Get-Content -Tail",
  },

  // grep -r pattern -> Select-String -Pattern pattern -Recurse
  {
    pattern: /^grep\s+(-[rinvE]+\s+)*['"]?([^'"]+)['"]?\s+(.+)$/,
    replacement: (m) => {
      const pattern = m[2];
      const path = m[3];
      const flags = m[1] || "";
      const recurse = flags.includes("r") ? " -Recurse" : "";
      return `Select-String -Pattern "${pattern}"${recurse} -Path ${path}`;
    },
    description: "grep -> Select-String",
  },

  // which -> Get-Command
  {
    pattern: /^which\s+(.+)$/,
    replacement: (m) => `Get-Command -Name ${m[1]} -ErrorAction SilentlyContinue`,
    description: "which -> Get-Command",
  },

  // wc -l -> measure line count
  {
    pattern: /^wc\s+-l\s+(.+)$/,
    replacement: (m) => `(Get-Content -Path ${m[1]}).Count`,
    description: "wc -l -> (Get-Content).Count",
  },

  // echo -> Write-Host
  {
    pattern: /^echo\s+(.+)$/,
    replacement: (m) => `Write-Host ${m[1]}`,
    description: "echo -> Write-Host",
  },

  // pwd -> Get-Location
  {
    pattern: /^pwd$/,
    replacement: () => `Get-Location`,
    description: "pwd -> Get-Location",
  },

  // env / printenv -> Get-ChildItem Env:
  {
    pattern: /^(env|printenv)$/,
    replacement: () => `Get-ChildItem Env:`,
    description: "env -> Get-ChildItem Env:",
  },

  // touch -> New-Item -ItemType File
  {
    pattern: /^touch\s+(.+)$/,
    replacement: (m) => `New-Item -ItemType File -Force -Path ${m[1]}`,
    description: "touch -> New-Item -ItemType File",
  },

  // cp -r -> Copy-Item -Recurse
  {
    pattern: /^cp\s+(-[rfiv]+\s+)*(.+)\s+(.+)$/,
    replacement: (m) => {
      const flags = m[1] || "";
      const recurse = flags.includes("r") || flags.includes("R") ? " -Recurse" : "";
      const force = flags.includes("f") ? " -Force" : "";
      return `Copy-Item${recurse}${force} -Path ${m[2]} -Destination ${m[3]}`;
    },
    description: "cp -> Copy-Item",
  },

  // mv -> Move-Item
  {
    pattern: /^mv\s+(-[fiv]+\s+)*(.+)\s+(.+)$/,
    replacement: (m) => {
      const flags = m[1] || "";
      const force = flags.includes("f") ? " -Force" : "";
      return `Move-Item${force} -Path ${m[2]} -Destination ${m[3]}`;
    },
    description: "mv -> Move-Item",
  },
];

/**
 * Attempt to translate a POSIX command to PowerShell
 * 
 * Returns the translated command if a match is found, otherwise returns the original.
 * Safe to call on all commands - only translates recognized patterns.
 */
export function translatePosixToPowerShell(command: string): {
  translated: string;
  wasTranslated: boolean;
  rule?: string;
} {
  const trimmed = command.trim();

  for (const rule of TRANSLATIONS) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      const translated = rule.replacement(match);
      return {
        translated,
        wasTranslated: true,
        rule: rule.description,
      };
    }
  }

  return {
    translated: trimmed,
    wasTranslated: false,
  };
}

/**
 * Check if PowerShell version supports chained commands (&& and ||)
 * 
 * PowerShell 7+ supports these, but Windows PowerShell 5.x does not.
 */
export function detectPowerShellVersion(command: string): {
  hasChainingOperator: boolean;
  recommendation?: string;
} {
  const hasAnd = command.includes("&&");
  const hasOr = command.includes("||");

  if (hasAnd || hasOr) {
    return {
      hasChainingOperator: true,
      recommendation:
        "Command uses && or || operators which require PowerShell 7+. " +
        "On Windows PowerShell 5.x, use ; to chain commands unconditionally.",
    };
  }

  return {
    hasChainingOperator: false,
  };
}

/**
 * Get all available translations as documentation
 */
export function getTranslationDocs(): string {
  const lines = [
    "POSIX-to-PowerShell Command Translation Table",
    "",
    "Common commands are automatically translated on Windows:",
    "",
  ];

  for (const rule of TRANSLATIONS) {
    lines.push(`  ${rule.description}`);
  }

  lines.push("");
  lines.push("Notes:");
  lines.push("  - Translations only apply on Windows (win32 platform)");
  lines.push("  - Original command is preserved if no translation matches");
  lines.push("  - && and || require PowerShell 7+ (use ; on PowerShell 5.x)");

  return lines.join("\n");
}
