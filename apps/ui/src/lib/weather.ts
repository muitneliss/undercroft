/**
 * The weather the title page is printed in.
 *
 * The sign-in board answers the reader's sky: night inks the board, rain hatches it, a cold
 * morning frosts its corners. Two sources feed it, and they are deliberately unequal.
 *
 * - **The clock is always read.** The hour on the reader's own device says night, dawn, day or
 *   dusk, with no request and no permission. It is a fact about the device, not a guess about
 *   the reader, so it is the floor every scene stands on.
 * - **The weather is read only when the reader asks.** Knowing it means knowing where they
 *   are, and this page is public: nobody has signed in, so nobody has agreed to anything. The
 *   page states what will happen before the browser asks (product principle 5), and only then
 *   asks the browser for a position.
 *
 * ## Why the position is rounded before it leaves
 *
 * Open-Meteo needs a coordinate, not an address. A tenth of a degree is about eleven
 * kilometres, which still names the right weather and no longer names a street. The rounded
 * pair goes to Open-Meteo and nowhere else; it is never stored, here or in the store.
 *
 * ## Why an unknown code is no weather at all
 *
 * A WMO code this table does not know is not "clear". Drawing sun for a code we cannot read
 * would be a confident picture of nothing, which is rule 2 broken in pixels. An unknown code,
 * a missing temperature or a malformed answer is a refused reading, and the page falls back to
 * the clock and says so.
 *
 * Winter is read the same way: from the temperature that was measured, never from the month.
 * Hanoi in January and Ho Chi Minh City in January share a calendar and not a season.
 */

/** Where the sun is, by the reader's clock. */
export type Light = "night" | "dawn" | "day" | "dusk";

/** What the sky is doing, from a WMO weather interpretation code. */
export type Sky = "clear" | "cloud" | "fog" | "drizzle" | "rain" | "storm" | "snow";

/** One answer from the weather service, refused unless every field could be read. */
export interface Reading {
  readonly sky: Sky;
  /** Air temperature two metres up, in degrees Celsius, as measured. */
  readonly temperature: number;
  /** The service's own word on whether the sun is up where the reader is. */
  readonly isDay: boolean;
}

/** What the board is printed as. */
export interface Scene {
  readonly light: Light;
  /** Null when there is no reading: the clock alone, and nothing drawn for a sky we never read. */
  readonly sky: Sky | null;
  readonly cold: boolean;
}

/** A position, already rounded, ready to be sent. */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** Why there is no reading: the browser kept the position, or the service gave nothing usable. */
export type WeatherRefusal = "denied" | "unavailable";

export class WeatherRefused extends Error {
  readonly reason: WeatherRefusal;

  constructor(reason: WeatherRefusal) {
    super(reason);
    this.name = "WeatherRefused";
    this.reason = reason;
  }
}

/** At or below this many degrees the board frosts. Hanoi's winter mornings sit just under it. */
const COLD_AT_OR_BELOW = 15;

const DAWN_FROM = 5;
const DAY_FROM = 7;
const DUSK_FROM = 17;
const NIGHT_FROM = 19;

/** The reader's local hour, read off their own clock. */
export function lightAt(now: Date): Light {
  const hour = now.getHours();
  if (hour < DAWN_FROM || hour >= NIGHT_FROM) {
    return "night";
  }
  if (hour < DAY_FROM) {
    return "dawn";
  }
  return hour < DUSK_FROM ? "day" : "dusk";
}

/**
 * The sky a WMO code names, or null for a code outside the table.
 *
 * The groups follow the WMO 4677 subset Open-Meteo documents: 0-1 mainly clear, 2-3 cloud,
 * 45/48 fog, 51-57 drizzle, 61-67 and 80-82 rain, 71-77 and 85-86 snow, 95-99 thunderstorm.
 */
export function skyOf(code: number): Sky | null {
  return SKY_BY_CODE.get(code) ?? null;
}

const SKY_BY_CODE: ReadonlyMap<number, Sky> = new Map<number, Sky>([
  ...codes([0, 1], "clear"),
  ...codes([2, 3], "cloud"),
  ...codes([45, 48], "fog"),
  ...codes([51, 53, 55, 56, 57], "drizzle"),
  ...codes([61, 63, 65, 66, 67, 80, 81, 82], "rain"),
  ...codes([71, 73, 75, 77, 85, 86], "snow"),
  ...codes([95, 96, 99], "storm"),
]);

function codes(list: readonly number[], sky: Sky): [number, Sky][] {
  return list.map((code) => [code, sky]);
}

/**
 * The scene for this minute: the clock's light, corrected by the service when it disagrees.
 *
 * The clock decides dawn and dusk, which the service does not name. Where the two disagree
 * outright -- the clock says day and the service says the sun is down, as it is in a northern
 * winter at half past five -- the service wins, because it knows where the reader is and the
 * clock only knows what time it is.
 */
export function sceneOf(now: Date, reading: Reading | null): Scene {
  const clock = lightAt(now);
  if (reading === null) {
    return { light: clock, sky: null, cold: false };
  }
  return {
    light: reconcile(clock, reading.isDay),
    sky: reading.sky,
    cold: reading.sky === "snow" || reading.temperature <= COLD_AT_OR_BELOW,
  };
}

/**
 * How far along its course the sun or moon is, from 0 at its rising to 1 at its setting.
 *
 * The sun's course runs from dawn's first hour to night's, and the moon's the other way round,
 * on the same boundaries `lightAt` reads, so a dawn sun is never drawn at the setting end. It
 * follows the scene's light rather than the raw hour: when the service says the sun is already
 * down at half past five, the moon is drawn, near its own setting end, not a morning sun.
 */
export function courseAt(now: Date, light: Light): number {
  const hours = now.getHours() + now.getMinutes() / 60;
  const sunUp = NIGHT_FROM - DAWN_FROM;
  const since = light === "night" ? hours - NIGHT_FROM : hours - DAWN_FROM;
  const span = light === "night" ? 24 - sunUp : sunUp;
  return Math.min(1, Math.max(0, (((since % 24) + 24) % 24) / span));
}

function reconcile(clock: Light, isDay: boolean): Light {
  if (isDay) {
    return clock === "night" ? "day" : clock;
  }
  return clock === "day" ? "night" : clock;
}

/** A tenth of a degree, about eleven kilometres: the right weather, not the right street. */
export function rounded(latitude: number, longitude: number): Coordinates {
  return { latitude: Math.round(latitude * 10) / 10, longitude: Math.round(longitude * 10) / 10 };
}

/**
 * Ask the browser where the reader is, coarsely.
 *
 * Low accuracy on purpose: a network fix is enough for weather and does not wake the GPS. A
 * position up to half an hour old is still the same weather.
 */
export function locate(geolocation: Geolocation | undefined): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (geolocation === undefined) {
      reject(new WeatherRefused("unavailable"));
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        resolve(rounded(position.coords.latitude, position.coords.longitude));
      },
      (error) => {
        reject(
          new WeatherRefused(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
        );
      },
      { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 15_000 },
    );
  });
}

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

/** The current weather at a rounded position, from Open-Meteo. Refuses rather than guesses. */
export async function readWeather(
  fetcher: typeof fetch,
  { latitude, longitude }: Coordinates,
): Promise<Reading> {
  const url = new URL(OPEN_METEO);
  url.searchParams.set("latitude", latitude.toFixed(1));
  url.searchParams.set("longitude", longitude.toFixed(1));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  const response = await fetcher(url).catch(() => null);
  if (response === null || !response.ok) {
    throw new WeatherRefused("unavailable");
  }
  const reading = parseReading(await response.json().catch(() => null));
  if (reading === null) {
    throw new WeatherRefused("unavailable");
  }
  return reading;
}

/** Open-Meteo's `current` block, or null when any field is missing or is not what it claims. */
export function parseReading(body: unknown): Reading | null {
  if (!(isRecord(body) && isRecord(body.current))) {
    return null;
  }
  const { temperature_2m: temperature, weather_code: code, is_day: isDay } = body.current;
  if (typeof temperature !== "number" || typeof code !== "number" || (isDay !== 0 && isDay !== 1)) {
    return null;
  }
  const sky = skyOf(code);
  return sky === null ? null : { sky, temperature, isDay: isDay === 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
