const API_BASE_URL = "https://my.meteoblue.com";
const LOCATION_BASE_URL = "https://www.meteoblue.com";

export class MeteoblueApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "MeteoblueApiError";
    this.status = status;
  }
}

export class MeteoblueClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
    if (!apiKey) {
      throw new Error("METEOBLUE_API_KEY is required");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("A fetch implementation is required");
    }
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async searchLocations(query, { language = "en", countryCode, page = 1, limit = 10 } = {}) {
    const url = new URL(`/${encodeURIComponent(language)}/server/search/query3`, LOCATION_BASE_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("page", String(page));
    url.searchParams.set("itemsPerPage", String(limit));
    if (countryCode) url.searchParams.set("iso2", countryCode.toUpperCase());

    return this.#requestJson(url, "location search");
  }

  async resolveLocation(query, options = {}) {
    const data = await this.searchLocations(query, { ...options, page: 1, limit: 1 });
    const location = data.results?.[0];
    if (!location) {
      throw new MeteoblueApiError(`No location found for “${query}”`, 404);
    }
    return location;
  }

  async getForecast({ packages, latitude, longitude, elevation, forecastDays, historyDays, timezone, temperatureUnit, windSpeedUnit, precipitationUnit }) {
    const url = new URL(`/packages/${packages.join(",")}`, API_BASE_URL);
    this.#addCoordinates(url, latitude, longitude, elevation);
    url.searchParams.set("apikey", this.apiKey);
    if (forecastDays !== undefined) url.searchParams.set("forecastDays", String(forecastDays));
    if (historyDays !== undefined) url.searchParams.set("historyDays", String(historyDays));
    if (timezone) url.searchParams.set("tz", timezone);
    if (temperatureUnit) url.searchParams.set("temperatureUnit", temperatureUnit);
    if (windSpeedUnit) url.searchParams.set("windSpeedUnit", windSpeedUnit);
    if (precipitationUnit) url.searchParams.set("precipitationUnit", precipitationUnit);

    return this.#requestJson(url, "forecast");
  }

  async getForecastImage({ type, latitude, longitude, elevation, options = {} }) {
    const url = new URL(`/images/${type}`, API_BASE_URL);
    this.#addCoordinates(url, latitude, longitude, elevation);
    url.searchParams.set("apikey", this.apiKey);
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const response = await this.#fetch(url);
    if (!response.ok) throw await this.#apiError(response, "forecast image");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "image/png";
    if (!contentType.startsWith("image/")) {
      throw new MeteoblueApiError("meteoblue returned a non-image response", response.status);
    }
    const data = Buffer.from(await response.arrayBuffer()).toString("base64");
    return { data, mimeType: contentType };
  }

  #addCoordinates(url, latitude, longitude, elevation) {
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    if (elevation !== undefined) url.searchParams.set("asl", String(elevation));
  }

  async #requestJson(url, operation) {
    const response = await this.#fetch(url);
    if (!response.ok) throw await this.#apiError(response, operation);
    try {
      return await response.json();
    } catch {
      throw new MeteoblueApiError(`meteoblue returned invalid JSON for ${operation}`, response.status);
    }
  }

  async #fetch(url) {
    try {
      return await this.fetch(url, {
        headers: { "user-agent": "mcp-meteoblue/1.0.2" },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new MeteoblueApiError("meteoblue request timed out");
      }
      throw new MeteoblueApiError(`Could not reach meteoblue: ${error.message}`);
    }
  }

  async #apiError(response, operation) {
    let detail = "";
    try {
      const body = await response.text();
      if (body && body.length < 500) {
        try {
          const parsed = JSON.parse(body);
          detail = parsed.message || parsed.error || parsed.detail || "";
        } catch {
          detail = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        }
      }
    } catch {
      // Keep the status-only error when the body cannot be read.
    }
    const suffix = detail ? `: ${detail}` : "";
    return new MeteoblueApiError(`meteoblue ${operation} request failed (${response.status})${suffix}`, response.status);
  }
}
