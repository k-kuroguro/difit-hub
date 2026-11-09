/** difit options that take a value. `targets` skips the word after each of them. */
const valued = new Set(['--port', '--host', '--comment', '--pr', '--context']);

/** The value after an option, such as 4966 in `--port 4966`. */
export function optValue(args: string[], name: string): string | undefined {
   const i = args.indexOf(name);
   return i >= 0 ? args[i + 1] : undefined;
}

const keywords: Record<string, string> = { '.': 'uncommitted', working: 'unstaged', staged: 'staged' };

/** How a review target reads in the list: difit's keyword targets as words, anything else as the git revision. */
export function targetLabel(target: string): string {
   return keywords[target] ?? (target || 'HEAD');
}

/** The review target in a difit command line, such as `.` or `HEAD`: every word that is not an option or its value. */
export function targets(args: string[]): string[] {
   return args.filter((a, i) => !a.startsWith('-') && !valued.has(args[i - 1]));
}
