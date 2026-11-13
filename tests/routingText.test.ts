// Unit tests for the Settings routing summary (lib/routingText). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRouting } from "../src/lib/routingText.ts";

const base = { dailyUsed: 1, dailyLimit: 3, claudeUsed: 0, claudeLimit: 3, unlimited: false };

test("describeRouting: the cap, the credits and the next provider, in the route's order", () => {
  const fresh = describeRouting(base, false);
  assert.equal(fresh.next, "claude");
  assert.match(fresh.headline, /2 of 3 left today\. 3 of 3 free tailored CVs left in total/);
  assert.match(fresh.detail, /free one.*own API key.*daily limit applies/);
  const withKey = describeRouting({ ...base, claudeUsed: 3 }, true);
  assert.equal(withKey.next, "openrouter");
  assert.match(withKey.headline, /free tailored CVs are used/);
  assert.match(withKey.detail, /uses your own API key/);
  const stuck = describeRouting({ ...base, claudeUsed: 3 }, false);
  assert.equal(stuck.next, "none");
  assert.match(stuck.detail, /Add your own API key/);
  const capped = describeRouting({ ...base, dailyUsed: 3 }, true);
  assert.equal(capped.next, "blocked");
  assert.match(capped.headline, /today's limit: 3 tailored CVs a day\. The limit also applies on your own API key/);
  const unlimited = describeRouting({ ...base, unlimited: true, dailyUsed: 7 }, false, "openrouter");
  assert.equal(unlimited.next, "openrouter");
  assert.match(unlimited.headline, /unlimited: no daily limit and no count of free tailored CVs\. 7 tailored CVs so far today/);
  assert.match(unlimited.detail, /uses OpenRouter \(the provider picked on the Tailor page\)/);
  assert.equal(describeRouting({ ...base, unlimited: true }, false).next, "claude");
  assert.equal(describeRouting(null, true).next, "none");
  assert.ok(!/without limits/.test(unlimited.headline), "the old absolute is gone");
});
