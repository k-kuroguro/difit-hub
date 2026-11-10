const valued = new Set(['--port', '--host', '--comment', '--pr', '--context']);

export function optValue(args: string[], name: string): string | undefined {
   const i = args.indexOf(name);
   return i >= 0 ? args[i + 1] : undefined;
}

const keywords: Record<string, string> = { '.': 'uncommitted', working: 'unstaged', staged: 'staged' };

export function targetLabel(target: string): string {
   return keywords[target] ?? (target || 'HEAD');
}

export function targets(args: string[]): string[] {
   return args.filter((a, i) => !a.startsWith('-') && !valued.has(args[i - 1]));
}
