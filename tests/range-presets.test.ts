import assert from "node:assert/strict";
import test from "node:test";
import { matchPreset, presetRange, presetRepeatsFull } from "../src/lib/range";

const DAY = 86_400;
const NOW = 1_792_051_200;

test("on a 4-day-old token the 7D and 30D presets only repeat Full history", () => {
  const young = { from: NOW - 4 * DAY, to: NOW };
  assert.equal(presetRepeatsFull("7d", young), true);
  assert.equal(presetRepeatsFull("30d", young), true);
  assert.equal(presetRepeatsFull("24h", young), false);
  assert.equal(presetRepeatsFull("launch", young), false);
  assert.equal(presetRepeatsFull("full", young), false, "Full history is never turned off");
  assert.equal(presetRepeatsFull("7d", { from: NOW - 40 * DAY, to: NOW }), false);
});

test("Full history reads as Full history, not as the first preset with the same range", () => {
  const young = { from: NOW - 4 * DAY, to: NOW };
  const full = presetRange("full", young, []);
  assert.deepEqual(presetRange("7d", young, []), full, "the bug: both presets clamp to the same range");
  assert.equal(matchPreset(full, young, []), "full");
  assert.equal(matchPreset(full, young, [], "full"), "full");
  assert.equal(matchPreset(full, young, [], "ath"), "ath", "a picked preset that matches wins");
  assert.equal(matchPreset(presetRange("24h", young, []), young, [], "full"), "24h", "a stale pick never sticks to a different range");
  assert.equal(matchPreset({ from: NOW - 2 * DAY, to: NOW - DAY / 2 }, young, []), undefined, "a dragged window is a custom period");
});
