import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

function loadCapture() {
  const source = readFileSync(new URL("../app/trade-snapshots.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const calls = { frame: 0, scheduled: 0, done: 0 };
  const exports = {};
  const context = createContext({
    exports,
    require: (id) => {
      if (id === "./screen-capture") return { grabScreenFrame: () => { calls.frame += 1; return "frame"; } };
      return {};
    },
    setTimeout: () => { calls.scheduled += 1; },
  });
  runInContext(compiled, context);
  return { capture: exports.captureScreenForTrade, calls };
}

test("confirmed-fill orders do not capture a screen or search legacy snapshots", () => {
  const { capture, calls } = loadCapture();
  capture("token", "AAPL", () => { calls.done += 1; }, false);
  assert.deepEqual(calls, { frame: 0, scheduled: 0, done: 1 });
});

test("legacy orders retain the existing capture behavior", () => {
  const { capture, calls } = loadCapture();
  capture("token", "AAPL", () => { calls.done += 1; });
  assert.deepEqual(calls, { frame: 1, scheduled: 1, done: 0 });
});
