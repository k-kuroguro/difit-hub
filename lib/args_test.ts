import { assertEquals } from '@std/assert';

import { optValue, targetLabel, targets } from './args.ts';

Deno.test('reads targets and option values from a difit command line', () => {
   const args = ['--port', '4966', 'HEAD~1', '--include-untracked', '--pr', 'https://x/pull/1', 'HEAD'];
   assertEquals(targets(args), ['HEAD~1', 'HEAD']);
   assertEquals(optValue(args, '--port'), '4966');
   assertEquals(optValue(args, '--host'), undefined);
});

Deno.test('labels keyword targets as words and leaves revisions as they are', () => {
   assertEquals(['.', 'working', 'staged', '', 'HEAD~2'].map(targetLabel), [
      'uncommitted',
      'unstaged',
      'staged',
      'HEAD',
      'HEAD~2',
   ]);
});
