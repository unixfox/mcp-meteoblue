import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FORECAST_IMAGE_TYPES, FREE_FORECAST_PACKAGES } from "./constants.js";
import { MeteoblueClient } from "./meteoblue.js";

const latitude = z.number().min(-90).max(90).optional().describe("WGS84 latitude; required with longitude when location is omitted");
const longitude = z.number().min(-180).max(180).optional().describe("WGS84 longitude; required with latitude when location is omitted");
const elevation = z.number().min(-500).max(9000).optional().describe("Elevation above sea level in metres");
const location = z.string().min(2).optional().describe("Place name, postal code, IATA, or ICAO code; resolved with meteoblue Location Search");

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

export function createServer({ apiKey = process.env.METEOBLUE_API_KEY, client } = {}) {
  const meteoblue = client || new MeteoblueClient({ apiKey });
  const server = new McpServer({ name: "mcp-meteoblue", version: "1.0.0" });

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
      description: "Get meteoblue forecast JSON by place name or coordinates. Place names are resolved through the Location Search API. Only packages documented for the Free Weather API are accepted.",
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
        precipitationUnit: z.enum(["metric", "imperial"]).default("metric")
      }
    },
    async (input) => {
      try {
        const coords = await coordinatesFor(meteoblue, input);
        const forecast = await meteoblue.getForecast({ ...input, ...coords });
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
