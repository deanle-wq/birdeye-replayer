import assert from "node:assert/strict";
import test from "node:test";
import { GET as chartToken } from "../src/app/api/chart/token/route";
import { GET as ohlcv } from "../src/app/api/ohlcv/route";
import { GET as pnlToken } from "../src/app/api/token/route";

const MINT = "EnAtbbo1AZWmuXA5PH1Gn4UgGpiTzzmaGbJpLWgjpump";

function get(path: string, ip: string) {
  return new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": ip } });
}

// No key anywhere: requests that pass the limiter stop at the key check, so
// nothing here reaches Birdeye.
function withoutKey(run: () => Promise<void>) {
  return async () => {
    const saved = process.env.BIRDEYE_API_KEY;
    delete process.env.BIRDEYE_API_KEY;
    process.env.RATE_LIMIT_PER_MINUTE = "1";
    try {
      await run();
    } finally {
      delete process.env.RATE_LIMIT_PER_MINUTE;
      if (saved !== undefined) process.env.BIRDEYE_API_KEY = saved;
    }
  };
}

test("the chart and PnL features keep separate token rate limits", withoutKey(async () => {
  const ip = "10.0.0.1";
  assert.notEqual((await pnlToken(get(`/api/token?mint=${MINT}`, ip))).status, 429);
  assert.equal((await pnlToken(get(`/api/token?mint=${MINT}`, ip))).status, 429, "the PnL bucket is spent");
  assert.notEqual((await chartToken(get(`/api/chart/token?mint=${MINT}`, ip))).status, 429, "the chart still has its own budget");
  assert.equal((await chartToken(get(`/api/chart/token?mint=${MINT}`, ip))).status, 429);
}));

test("sample candles are free; live candles still count", withoutKey(async () => {
  const ip = "10.0.0.2";
  const window = "from=1790000000&to=1790086400&timeframe=1H";
  for (let i = 0; i < 6; i += 1) {
    const response = await ohlcv(get(`/api/ohlcv?demo=1&mint=${MINT}&${window}`, ip));
    assert.equal(response.status, 200, `sample request ${i + 1}`);
  }
  // RATE_LIMIT_PER_MINUTE=1 with the OHLCV multiplier of 3: three live requests, then 429.
  for (let i = 0; i < 3; i += 1) assert.notEqual((await ohlcv(get(`/api/ohlcv?mint=${MINT}&${window}`, ip))).status, 429);
  assert.equal((await ohlcv(get(`/api/ohlcv?mint=${MINT}&${window}`, ip))).status, 429);
}));
