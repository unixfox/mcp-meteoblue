import assert from "node:assert/strict";
import test from "node:test";
import { MeteoblueApiError, MeteoblueClient } from "../src/meteoblue.js";

test("searchLocations encodes parameters and never exposes the key in the result", async () => {
  let requestedUrl;
  const client = new MeteoblueClient({
    apiKey: "secret-key",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return Response.json({ results: [{ name: "Paris", lat: 48.85, lon: 2.35 }] });
    }
  });
  const result = await client.searchLocations("Paris", { language: "fr", countryCode: "fr", limit: 5 });
  assert.equal(result.results[0].name, "Paris");
  assert.equal(requestedUrl.pathname, "/fr/server/search/query3");
  assert.equal(requestedUrl.searchParams.get("query"), "Paris");
  assert.equal(requestedUrl.searchParams.get("iso2"), "FR");
  assert.equal(requestedUrl.searchParams.get("itemsPerPage"), "5");
  assert.equal(requestedUrl.searchParams.get("apikey"), "secret-key");
});

test("getForecast uses comma-separated package names and supported options", async () => {
  let requestedUrl;
  const client = new MeteoblueClient({
    apiKey: "secret-key",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return Response.json({ metadata: {}, units: {}, data_1h: {} });
    }
  });
  await client.getForecast({
    packages: ["current", "basic-1h"],
    latitude: 48.8566,
    longitude: 2.3522,
    elevation: 35,
    forecastDays: 3,
    temperatureUnit: "C"
  });
  assert.equal(requestedUrl.pathname, "/packages/current,basic-1h");
  assert.equal(requestedUrl.searchParams.get("lat"), "48.8566");
  assert.equal(requestedUrl.searchParams.get("asl"), "35");
  assert.equal(requestedUrl.searchParams.get("forecastDays"), "3");
});

test("getForecastImage returns base64 image content", async () => {
  const client = new MeteoblueClient({
    apiKey: "secret-key",
    fetchImpl: async () => new Response(Uint8Array.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" } })
  });
  const result = await client.getForecastImage({ type: "meteogram", latitude: 1, longitude: 2 });
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.data, "iVBORw==");
});

test("API errors do not include request URLs or API keys", async () => {
  const client = new MeteoblueClient({
    apiKey: "secret-key",
    fetchImpl: async () => new Response(JSON.stringify({ message: "not authorized" }), { status: 403 })
  });
  await assert.rejects(
    () => client.getForecast({ packages: ["current"], latitude: 1, longitude: 2 }),
    (error) => error instanceof MeteoblueApiError && error.status === 403 && !error.message.includes("secret-key")
  );
});

test("missing API key fails fast", () => {
  assert.throws(() => new MeteoblueClient(), /METEOBLUE_API_KEY/);
});
