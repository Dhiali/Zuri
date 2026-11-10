import assert from "node:assert/strict";
import { test } from "node:test";
import { glanceOffset } from "../app/zuri-glances.ts";

test("glances follow the relative position of the other mascot", () => {
  assert.deepEqual(glanceOffset({ x: 10, y: 10 }, { x: 20, y: 10 }), { x: 5, y: 0 });
  assert.deepEqual(glanceOffset({ x: 20, y: 10 }, { x: 10, y: 10 }), { x: -5, y: 0 });
  assert.deepEqual(glanceOffset({ x: 10, y: 10 }, { x: 10, y: 20 }), { x: 0, y: 4 });
  assert.deepEqual(glanceOffset({ x: 10, y: 10 }, { x: 10, y: 10 }), { x: 0, y: 0 });
});
