import assert from "node:assert/strict";
import test from "node:test";
import { filterHourlyForecast } from "../src/server.js";

function fixture() {
  return {
    metadata: { modelrun: "test" },
    units: { temperature: "C" },
    data_current: { temperature: 20 },
    data_day: { time: ["2026-08-23", "2026-08-24"] },
    data_1h: {
      time: [
        "2026-08-23 13:00",
        "2026-08-23 14:00",
        "2026-08-23 15:00",
        "2026-08-23 16:00",
        "2026-08-23 17:00",
        "2026-08-24 14:00",
        "2026-08-24 15:00",
        "2026-08-24 16:00",
        "2026-08-24 23:00",
        "2026-08-25 00:00",
        "2026-08-25 01:00",
        "2026-08-25 02:00",
        "2026-08-25 03:00"
      ],
      temperature: [13, 14, 15, 16, 17, 24, 25, 26, 23, 20, 19, 18, 17],
      model: "mlm"
    }
  };
}

test("filters an inclusive range on tomorrow using dayOffset", () => {
  const result = filterHourlyForecast(fixture(), {
    startHour: "14:00",
    endHour: "16:00",
    dayOffset: 1
  });
  assert.deepEqual(result.data_1h.time, [
    "2026-08-24 14:00",
    "2026-08-24 15:00",
    "2026-08-24 16:00"
  ]);
  assert.deepEqual(result.data_1h.temperature, [24, 25, 26]);
  assert.equal(result.data_1h.model, "mlm");
  assert.equal(result.data_current, undefined);
  assert.equal(result.data_day, undefined);
});

test("filters an explicit-date range", () => {
  const result = filterHourlyForecast(fixture(), {
    startHour: "14:00",
    endHour: "16:00",
    date: "2026-08-23"
  });
  assert.deepEqual(result.data_1h.temperature, [14, 15, 16]);
  assert.equal(result.requestedRange.date, "2026-08-23");
});

test("supports a range crossing midnight", () => {
  const result = filterHourlyForecast(fixture(), {
    startHour: "23:00",
    endHour: "02:00",
    date: "2026-08-24"
  });
  assert.deepEqual(result.data_1h.time, [
    "2026-08-24 23:00",
    "2026-08-25 00:00",
    "2026-08-25 01:00",
    "2026-08-25 02:00"
  ]);
});

test("rejects a date outside the forecast", () => {
  assert.throws(
    () => filterHourlyForecast(fixture(), { startHour: "14:00", endHour: "16:00", date: "2026-08-30" }),
    /No hourly forecast data/
  );
});
