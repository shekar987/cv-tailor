// Is this failure "the account is out of credit"? node:test, zero deps.
//
// The regression this guards: on 2026-09-24 production tailoring returned a
// bare 500 for every user because the shared Anthropic balance hit zero, and
// nothing distinguished that from an ordinary server fault. The opposite
// mistake matters just as much — calling a normal 400 a billing problem would
// send users to buy credit they don't need.
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeBilling } from "../src/lib/providerErrors.ts";

test("the real Anthropic message that took production down is recognised", () => {
  const real =
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
  assert.equal(looksLikeBilling(400, real), true);
  // The SDK surfaces it with the status separately, too.
  assert.equal(looksLikeBilling(undefined, real), true);
});

test("402 is billing whatever the body says", () => {
  assert.equal(looksLikeBilling(402, ""), true);
  assert.equal(looksLikeBilling(402, "anything at all"), true);
});

test("other providers' phrasings", () => {
  assert.equal(looksLikeBilling(403, "You exceeded your current quota, please check your plan and billing details"), true);
  assert.equal(looksLikeBilling(400, "Insufficient credits to complete this request"), true);
  assert.equal(looksLikeBilling(400, "insufficient balance"), true);
});

test("an ordinary provider fault is NOT billing — the costly false positive", () => {
  assert.equal(looksLikeBilling(400, 'invalid_request_error: max_tokens must be greater than 0'), false);
  assert.equal(looksLikeBilling(400, "messages: at least one message is required"), false);
  assert.equal(looksLikeBilling(500, "internal server error"), false);
  // A rate limit is its own error with its own handling — never billing.
  assert.equal(looksLikeBilling(429, "rate limit exceeded"), false);
  // Even the billing words on a status that isn't a client refusal.
  assert.equal(looksLikeBilling(503, "billing"), false);
  assert.equal(looksLikeBilling(400, ""), false);
  assert.equal(looksLikeBilling(undefined, ""), false);
});
