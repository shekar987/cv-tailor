// Unit tests for role-targeted variants (Brief 3, part 3). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVariants, pickVariant, renderVariantBlock, MAX_VARIANTS } from "../src/lib/variants.ts";

const config = normalizeVariants({
  variants: [
    { id: "be", name: "Backend", headline: "Backend engineer (Java, Spring Boot)", roleTypes: ["backend", "fullstack"], leadSkills: ["Java", "Spring Boot", "PostgreSQL"] },
    { id: "plat", name: "Platform", headline: "Platform engineer (CI/CD, AWS)", roleTypes: ["devops"], leadSkills: ["GitHub Actions", "Docker", "Terraform"] },
  ],
})!;

test("normalizeVariants bounds and defaults", () => {
  assert.equal(normalizeVariants(null), null);
  assert.equal(normalizeVariants({ variants: "x" }), null);
  const v = normalizeVariants({
    variants: [
      { id: "bad id!", name: "  A  ", headline: "x".repeat(200), roleTypes: ["backend", "wizard", "backend"], leadSkills: ["Java", "java", 3] },
      { name: "" },
      ...Array.from({ length: 10 }, (_, i) => ({ name: `V${i}` })),
    ],
  })!;
  assert.equal(v.variants.length, MAX_VARIANTS);
  assert.equal(v.variants[0].name, "A");
  assert.equal(v.variants[0].headline.length, 120);
  assert.deepEqual(v.variants[0].roleTypes, ["backend"]);
  assert.deepEqual(v.variants[0].leadSkills, ["Java"]);
  assert.match(v.variants[0].id, /^v[a-z0-9]+$/);
});

test("pickVariant: override wins, then role type, then a lone catch-all, else none", () => {
  assert.equal(pickVariant(config, "backend").variant?.id, "be");
  assert.equal(pickVariant(config, "fullstack").variant?.id, "be");
  assert.equal(pickVariant(config, "devops").variant?.id, "plat");
  assert.equal(pickVariant(config, "devops").source, "role_type");
  assert.equal(pickVariant(config, "backend", "plat").variant?.id, "plat");
  assert.equal(pickVariant(config, "backend", "plat").source, "override");
  assert.equal(pickVariant(config, "backend", "none").variant, null);
  const none = pickVariant(config, "ml_engineering");
  assert.equal(none.variant, null);
  assert.match(none.reason, /ML engineering/);
  assert.equal(pickVariant(config, undefined).variant, null);
  assert.equal(pickVariant(null, "backend").source, "none");
  const lone = normalizeVariants({ variants: [{ name: "Only", headline: "h", roleTypes: [], leadSkills: [] }] })!;
  assert.equal(pickVariant(lone, "frontend").source, "single");
});

test("renderVariantBlock names the positioning and the lead skills", () => {
  assert.equal(renderVariantBlock(null), "");
  const block = renderVariantBlock(config.variants[0]);
  assert.ok(block.includes('"Backend"'));
  assert.ok(block.includes("Backend engineer (Java, Spring Boot)"));
  assert.ok(block.includes("Java, Spring Boot, PostgreSQL"));
  assert.ok(/skip any it does not/.test(block));
});
