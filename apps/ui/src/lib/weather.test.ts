/**
 * The title page's weather: what leaves the browser, what is refused, and what the board is
 * printed as.
 */

import { describe, expect, test as it } from "bun:test";

import { courseAt, lightAt, readWeather, rounded, sceneOf, WeatherRefused } from "./weather.ts";

/** Open-Meteo's answer for a drizzly Hanoi winter morning. */
const DRIZZLE_AT_13 = {
  current: { time: "2027-01-12T06:30", temperature_2m: 13.4, weather_code: 53, is_day: 0 },
};

/** A fetch that answers one body and keeps every address it was asked for. */
function serviceAnswering(body: unknown, status = 200): { fetcher: typeof fetch; asked: URL[] } {
  const asked: URL[] = [];
  function fetcher(input: string | URL | Request): Promise<Response> {
    asked.push(new URL(input instanceof Request ? input.url : input));
    return Promise.resolve(Response.json(body, { status }));
  }
  return { fetcher: fetcher as typeof fetch, asked };
}

describe("readWeather", () => {
  it("sends Open-Meteo a position rounded to a tenth of a degree and nothing finer", async () => {
    const { fetcher, asked } = serviceAnswering(DRIZZLE_AT_13);

    const reading = await readWeather(fetcher, rounded(21.028_511, 105.854_164));

    expect(reading).toEqual({ sky: "drizzle", temperature: 13.4, isDay: false });
    expect(
      asked.map((url) => [
        url.host,
        url.searchParams.get("latitude"),
        url.searchParams.get("longitude"),
      ]),
    ).toEqual([["api.open-meteo.com", "21.0", "105.9"]]);
  });

  it("refuses a weather code it cannot read rather than drawing a clear sky", async () => {
    const { fetcher } = serviceAnswering({
      current: { ...DRIZZLE_AT_13.current, weather_code: 4 },
    });

    const refusal = await readWeather(fetcher, rounded(21, 105.8)).catch((error: unknown) => error);

    if (!(refusal instanceof WeatherRefused)) {
      throw refusal;
    }
    expect(refusal.reason).toBe("unavailable");
  });
});

describe("sceneOf", () => {
  it("frosts the board from the measured temperature, never from the month", () => {
    const january = new Date(2027, 0, 12, 10, 0);
    const warm = { sky: "clear", temperature: 29, isDay: true } as const;

    expect(sceneOf(january, warm)).toEqual({ light: "day", sky: "clear", cold: false });
    expect(sceneOf(january, { ...warm, temperature: 13 })).toEqual({
      light: "day",
      sky: "clear",
      cold: true,
    });
  });

  it("lets the service darken a board the clock thinks is lit", () => {
    const halfPastSeven = new Date(2027, 0, 12, 7, 30);

    expect(lightAt(halfPastSeven)).toBe("day");
    expect(sceneOf(halfPastSeven, { sky: "drizzle", temperature: 13.4, isDay: false }).light).toBe(
      "night",
    );
  });

  it("draws a dawn sun at its rising end and a dusk sun at its setting end", () => {
    expect(courseAt(new Date(2027, 0, 12, 5, 30), "dawn")).toBeLessThan(0.1);
    expect(courseAt(new Date(2027, 0, 12, 18, 30), "dusk")).toBeGreaterThan(0.9);
    // The service has said the sun is down at half past seven: a moon about to set.
    expect(courseAt(new Date(2027, 0, 12, 7, 30), "night")).toBe(1);
  });

  it("prints the clock alone, with no sky, when the reader has not asked for the weather", () => {
    expect(sceneOf(new Date(2027, 0, 12, 22, 14), null)).toEqual({
      light: "night",
      sky: null,
      cold: false,
    });
  });
});
