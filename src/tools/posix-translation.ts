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

function quotePowerShellString(value: string | undefined): string {
  const text = (value ?? "").trim();
  return `'${text.replaceAll("'", "''")}'`;
}

function parseShellWords(input: string | undefined): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const ch of input ?? "") {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}

function quotePowerShellArray(values: string[]): string {
  const items = values.length > 0 ? values : ["."];
  return items.map((value) => quotePowerShellString(value)).join(", ");
}

function hasUnquotedChainingOperator(command: string): boolean {
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    const next = command[i + 1];
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      return true;
    }
  }

  return false;
}

function hasUnquotedShellOperator(command: string): boolean {
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === "|" || ch === ">" || ch === "<" || ch === ";" || ch === "&") {
      return true;
    }
  }

  return false;
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
    replacement: (m) => `New-Item -ItemType Directory -Force -Path ${quotePowerShellArray(parseShellWords(m[1]))}`,
    description: "mkdir -p -> New-Item -Force",
  },

  // rm -rf (recursive force delete)
  {
    pattern: /^rm\s+((?:-[rRfivI]+\s+)*)?(.+)$/,
    replacement: (m) => {
      const flags = m[1] || "";
      const recurse = flags.includes("r") || flags.includes("R") ? " -Recurse" : "";
      const force = flags.includes("f") ? " -Force" : "";
      const verbose = flags.includes("v") ? " -Verbose" : "";
      const confirm = flags.includes("i") || flags.includes("I") ? " -Confirm" : "";
      return `Remove-Item${recurse}${force}${verbose}${confirm} -Path ${quotePowerShellArray(parseShellWords(m[2]))}`;
    },
    description: "rm -> Remove-Item",
  },

  // ls with args -> Get-ChildItem
  {
    pattern: /^ls(?:\s+(.*))?$/,
    replacement: (m) => {
      const args = (m[1] || "").trim();
      const parts = parseShellWords(args);
      const flags = parts.filter((part) => /^-[alhrtSR]+$/.test(part)).join("");
      const paths = parts.filter((part) => !/^-[alhrtSR]+$/.test(part));
      const recurse = flags.includes("R") ? " -Recurse" : "";
      const force = flags.includes("a") ? " -Force" : "";
      return `Get-ChildItem${recurse}${force} -Path ${quotePowerShellArray(paths)}`;
    },
    description: "ls -> Get-ChildItem",
  },

  // cat -> Get-Content
  {
    pattern: /^cat\s+(.+)$/,
    replacement: (m) => `Get-Content -Path ${quotePowerShellArray(parseShellWords(m[1]))}`,
    description: "cat -> Get-Content",
  },

  // head -n X -> Get-Content -TotalCount X
  {
    pattern: /^head\s+-n\s+(\d+)\s+(.+)$/,
    replacement: (m) => `Get-Content -TotalCount ${m[1]} -Path ${quotePowerShellArray(parseShellWords(m[2]))}`,
    description: "head -n -> Get-Content -TotalCount",
  },

  // tail -n X -> Get-Content -Tail X
  {
    pattern: /^tail\s+-n\s+(\d+)\s+(.+)$/,
    replacement: (m) => `Get-Content -Tail ${m[1]} -Path ${quotePowerShellArray(parseShellWords(m[2]))}`,
    description: "tail -n -> Get-Content -Tail",
  },

  // grep -r pattern -> Select-String -Pattern pattern -Recurse
  {
    pattern: /^grep\s+((?:-[rinvE]+\s+)*)['"]?([^'"]+)['"]?\s+(.+)$/,
    replacement: (m) => {
      const pattern = m[2];
      const path = m[3];
      const flags = m[1] || "";
      const recurse = flags.includes("r") ? " -Recurse" : "";
      return `Select-String -Pattern ${quotePowerShellString(pattern)}${recurse} -Path ${quotePowerShellArray(parseShellWords(path))}`;
    },
    description: "grep -> Select-String",
  },

  // which -> Get-Command
  {
    pattern: /^which\s+(.+)$/,
    replacement: (m) => `Get-Command -Name ${quotePowerShellString(m[1])} -ErrorAction SilentlyContinue`,
    description: "which -> Get-Command",
  },

  // wc -l -> measure line count
  {
    pattern: /^wc\s+-l\s+(.+)$/,
    replacement: (m) => `(Get-Content -Path ${quotePowerShellArray(parseShellWords(m[1]))}).Count`,
    description: "wc -l -> (Get-Content).Count",
  },

  // echo -> Write-Output
  {
    pattern: /^echo\s+(.+)$/,
    replacement: (m) => `Write-Output ${quotePowerShellString(parseShellWords(m[1]).join(" "))}`,
    description: "echo -> Write-Output",
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
    replacement: (m) => `New-Item -ItemType File -Force -Path ${quotePowerShellArray(parseShellWords(m[1]))}`,
    description: "touch -> New-Item -ItemType File",
  },

  // cp -r -> Copy-Item -Recurse
  {
    pattern: /^cp\s+((?:-[rRfiv]+\s+)*)(.+)$/,
    replacement: (m) => {
      const flags = m[1] || "";
      const paths = parseShellWords(m[2]);
      const destination = paths.at(-1);
      const sources = paths.slice(0, -1);
      const recurse = flags.includes("r") || flags.includes("R") ? " -Recurse" : "";
      const force = flags.includes("f") ? " -Force" : "";
      if (!destination || sources.length === 0) return m[0] ?? "";
      return `Copy-Item${recurse}${force} -Path ${quotePowerShellArray(sources)} -Destination ${quotePowerShellString(destination)}`;
    },
    description: "cp -> Copy-Item",
  },

  // mv -> Move-Item
  {
    pattern: /^mv\s+((?:-[fiv]+\s+)*)(.+)$/,
    replacement: (m) => {
      const flags = m[1] || "";
      const paths = parseShellWords(m[2]);
      const destination = paths.at(-1);
      const sources = paths.slice(0, -1);
      const force = flags.includes("f") ? " -Force" : "";
      if (!destination || sources.length === 0) return m[0] ?? "";
      return `Move-Item${force} -Path ${quotePowerShellArray(sources)} -Destination ${quotePowerShellString(destination)}`;
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

  // Translate only simple single commands. Compound commands, pipelines, and
  // redirects need full-shell parsing; partial regex rewrites are unsafe.
  if (hasUnquotedShellOperator(trimmed)) {
    return {
      translated: trimmed,
      wasTranslated: false,
    };
  }

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
  if (hasUnquotedChainingOperator(command)) {
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
