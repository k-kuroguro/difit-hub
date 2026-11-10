import { assert, assertEquals } from '@std/assert';

import { markDone, readRequests, requestReview } from './requests.ts';

Deno.test('requests a review, marks it done, and forgets stopped servers', async () => {
   const dir = await Deno.makeTempDir();
   try {
      await requestReview('4966:1', 'check the parser', new Set(['4966:1']), dir);
      await requestReview('4967:2', '', new Set(['4967:2']), dir);
      assertEquals(Object.keys(await readRequests(dir)), ['4967:2']);

      await requestReview('4966:1', 'again', new Set(['4966:1', '4967:2']), dir);
      assert(await markDone('4966:1', dir));
      assert(!await markDone('4968:3', dir));
      const requests = await readRequests(dir);
      assertEquals(requests['4966:1'].message, 'again');
      assert(requests['4966:1'].done !== null);
      assertEquals(requests['4967:2'].done, null);
   } finally {
      await Deno.remove(dir, { recursive: true });
   }
});
