import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { rateLimited } from "../src/server/guard";

function request(ip: string) {
  return new Request("http://localhost/api/analyze", { headers: { "x-forwarded-for": ip } });
}

test("rate limit caps one address per minute and leaves others alone", () => {
  process.env.RATE_LIMIT_PER_MINUTE = "3";
  for (let i = 0; i < 3; i += 1) assert.equal(rateLimited(request("1.1.1.1"), "test"), null);
  assert.equal(rateLimited(request("1.1.1.1"), "test")?.status, 429);
  assert.equal(rateLimited(request("2.2.2.2"), "test"), null);
  process.env.RATE_LIMIT_PER_MINUTE = "0";
  assert.equal(rateLimited(request("1.1.1.1"), "test"), null, "0 disables the limit");
  delete process.env.RATE_LIMIT_PER_MINUTE;
});

test("site password is off by default and enforced when set", () => {
  delete process.env.SITE_PASSWORD;
  assert.notEqual(proxy(new NextRequest("http://localhost/")).status, 401);
  process.env.SITE_PASSWORD = "birdeye";
  assert.equal(proxy(new NextRequest("http://localhost/")).status, 401);
  const wrong = new NextRequest("http://localhost/", { headers: { authorization: `Basic ${btoa("team:nope")}` } });
  assert.equal(proxy(wrong).status, 401);
  const right = new NextRequest("http://localhost/", { headers: { authorization: `Basic ${btoa("team:birdeye")}` } });
  assert.notEqual(proxy(right).status, 401);
  delete process.env.SITE_PASSWORD;
});
