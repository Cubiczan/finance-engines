import test from "node:test";
import assert from "node:assert/strict";

import {
  PROCUREMENT_PROFITABILITY_CONTRACT_VERSION,
} from "../dist/index.js";

test("exports the procurement integration contract version", () => {
  assert.equal(
    PROCUREMENT_PROFITABILITY_CONTRACT_VERSION,
    "procurement-profitability.v1",
  );
});
