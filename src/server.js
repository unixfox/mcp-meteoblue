import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FORECAST_IMAGE_TYPES, FREE_FORECAST_PACKAGES } from "./constants.js";
import { MeteoblueClient } from "./meteoblue.js";

const latitude = z.number().min(-90).max(90).optional().describe("WGS84 latitude; required with longitude when location is omitted");
const longitude = z.number().min(-180).max(180).optional().describe("WGS84 longitude; required with latitude when location is omitted");
const elevation = z.number().min(-500).max(9000).optional().describe("Elevation above sea level in metres");
const location = z.string().min(2).optional().describe("Place name, postal code, IATA, or ICAO code; resolved with meteoblue Location Search");
const hour = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional();

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  return { isError: true, content: [{ type: "text", text: error.message || "Unexpected error" }] };
}

async function coordinatesFor(client, input) {
  if (input.location) {
    const resolved = await client.resolveLocation(input.location, {
      language: input.language,
      countryCode: input.countryCode
    });
    return {
      latitude: resolved.lat,
      longitude: resolved.lon,
      elevation: input.elevation ?? resolved.asl,
      resolvedLocation: resolved
    };
  }
  if (input.latitude === undefined || input.longitude === undefined) {
    throw new Error("Provide either location, or both latitude and longitude");
  }
  return { latitude: input.latitude, longitude: input.longitude, elevation: input.elevation };
}

function minutesSinceMidnight(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function datePart(value) {
  return value.slice(0, 10);
}

function timePart(value) {
  const match = value.match(/(?:T|\s)(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function filterHourlyForecast(forecast, { startHour, endHour, date, dayOffset }) {
  const hourly = forecast.data_1h;
  if (!hourly?.time?.length) {
    throw new Error("meteoblue returned no hourly data for the requested range");
  }

  const availableDates = [...new Set(hourly.time.map(datePart))];
  const targetDate = date ?? (dayOffset !== undefined ? availableDates[dayOffset] : undefined);
  if ((date || dayOffset !== undefined) && !targetDate) {
    throw new Error("The requested date is outside the returned forecast period");
  }

  const startMinutes = minutesSinceMidnight(startHour);
  const endMinutes = minutesSinceMidnight(endHour);
  const crossesMidnight = endMinutes < startMinutes;
  const nextDate = targetDate && crossesMidnight ? addDays(targetDate, 1) : undefined;
  const selectedIndices = [];

  for (const [index, timestamp] of hourly.time.entries()) {
    const rowDate = datePart(timestamp);
    const rowTime = timePart(timestamp);
    if (!rowTime) continue;
    const rowMinutes = minutesSinceMidnight(rowTime);

    let selected;
    if (targetDate) {
      selected = crossesMidnight
        ? (rowDate === targetDate && rowMinutes >= startMinutes) || (rowDate === nextDate && rowMinutes <= endMinutes)
        : rowDate === targetDate && rowMinutes >= startMinutes && rowMinutes <= endMinutes;
    } else {
      selected = crossesMidnight
        ? rowMinutes >= startMinutes || rowMinutes <= endMinutes
        : rowMinutes >= startMinutes && rowMinutes <= endMinutes;
    }
    if (selected) selectedIndices.push(index);
  }

  if (!selectedIndices.length) {
    throw new Error("No hourly forecast data falls within the requested range");
  }

  const filteredHourly = Object.fromEntries(
    Object.entries(hourly).map(([key, value]) => [
      key,
      Array.isArray(value) && value.length === hourly.time.length
        ? selectedIndices.map((index) => value[index])
        : value
    ])
  );

  return {
    metadata: forecast.metadata,
    units: forecast.units,
    requestedRange: {
      startHour,
      endHour,
      ...(targetDate ? { date: targetDate } : {}),
      inclusive: true,
      crossesMidnight
    },
    data_1h: filteredHourly
  };
}

export function createServer({ apiKey = process.env.METEOBLUE_API_KEY, client } = {}) {
  const meteoblue = client || new MeteoblueClient({ apiKey });
  const server = new McpServer({ name: "mcp-meteoblue", version: "1.0.2" });

  server.registerTool(
    "search_locations",
    {
      title: "Search meteoblue locations",
      description: "Resolve a city, place, postal code, IATA code, or ICAO code to coordinates and elevation using the meteoblue Location Search API.",
      inputSchema: {
        query: z.string().min(2).describe("Location search text"),
        language: z.string().regex(/^[a-z]{2}$/i).default("en").describe("Two-letter result language"),
        countryCode: z.string().regex(/^[a-z]{2}$/i).optional().describe("Optional ISO 3166-1 alpha-2 country filter"),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(10)
      }
    },
    async (input) => {
      try {
        return textResult(await meteoblue.searchLocations(input.query, input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_forecast",
    {
      title: "Get meteoblue weather forecast",
      description: "Get meteoblue forecast JSON by place name or coordinates. Place names are resolved through the Location Search API. For a specific time window, provide startHour and endHour plus either date or dayOffset; the tool then returns only inclusive basic-1h rows in that range.",
      inputSchema: {
        location,
        latitude,
        longitude,
        elevation,
        language: z.string().regex(/^[a-z]{2}$/i).default("en"),
        countryCode: z.string().regex(/^[a-z]{2}$/i).optional(),
        packages: z.array(z.enum(FREE_FORECAST_PACKAGES)).min(1).max(10).default(["current", "basic-1h", "basic-day"]),
        forecastDays: z.number().int().min(0).max(7).default(7),
        historyDays: z.number().int().min(0).max(4).default(0),
        timezone: z.string().optional().describe("IANA timezone such as Europe/Paris; auto-detected when omitted"),
        temperatureUnit: z.enum(["C", "K", "F"]).default("C"),
        windSpeedUnit: z.enum(["m/s", "km/h", "mph", "kn", "bft"]).default("km/h"),
        precipitationUnit: z.enum(["metric", "imperial"]).default("metric"),
        startHour: hour.describe("Inclusive local start time in HH:mm format, for example 14:00; must be used with endHour"),
        endHour: hour.describe("Inclusive local end time in HH:mm format, for example 16:00; must be used with startHour"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Local forecast date in YYYY-MM-DD format for the hour range"),
        dayOffset: z.number().int().min(0).max(6).optional().describe("Forecast day for the hour range: 0 is today/first returned day, 1 is tomorrow; use instead of date")
      }
    },
    async (input) => {
      try {
        const hasHourRange = input.startHour !== undefined || input.endHour !== undefined;
        if (hasHourRange && (!input.startHour || !input.endHour)) {
          throw new Error("startHour and endHour must be provided together");
        }
        if (!hasHourRange && (input.date || input.dayOffset !== undefined)) {
          throw new Error("date and dayOffset can only be used with startHour and endHour");
        }
        if (input.date && input.dayOffset !== undefined) {
          throw new Error("Use either date or dayOffset, not both");
        }

        const coords = await coordinatesFor(meteoblue, input);
        const request = hasHourRange
          ? {
              ...input,
              packages: ["basic-1h"],
              forecastDays: input.dayOffset !== undefined
                ? Math.max(input.forecastDays, input.dayOffset + 1)
                : input.forecastDays,
              ...coords
            }
          : { ...input, ...coords };
        const rawForecast = await meteoblue.getForecast(request);
        const forecast = hasHourRange ? filterHourlyForecast(rawForecast, input) : rawForecast;
        return textResult({ resolvedLocation: coords.resolvedLocation, forecast });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_forecast_image",
    {
      title: "Get meteoblue forecast image",
      description: "Generate a meteoblue forecast meteogram by place name or coordinates. Returns the PNG directly. Image access depends on the API key's meteoblue entitlement.",
      inputSchema: {
        type: z.enum(FORECAST_IMAGE_TYPES).default("meteogram"),
        location,
        latitude,
        longitude,
        elevation,
        language: z.string().regex(/^[a-z]{2}$/i).default("en"),
        countryCode: z.string().regex(/^[a-z]{2}$/i).optional(),
        options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}).describe("Image-specific meteoblue query parameters")
      }
    },
    async (input) => {
      try {
        const coords = await coordinatesFor(meteoblue, input);
        const image = await meteoblue.getForecastImage({ ...input, ...coords });
        return { content: [{ type: "image", data: image.data, mimeType: image.mimeType }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}
