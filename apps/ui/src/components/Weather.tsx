/**
 * The title page's weather: the board the sign-in leaf lies on, printed in the reader's sky.
 *
 * Everything drawn here is printed matter that moves the way printed matter does: a flip book.
 * Rain is hatching that drops a few frames at a time, snow is a sheet of marks stepping down,
 * clouds are banks of ruled hairlines that shuffle along a step a second, and the sun's rays
 * tick round like a clock. No frame is eased (DESIGN.md: motion is stepped), so the weather
 * reads as the same book as every leaf after it, not as a screensaver behind one.
 *
 * ## What is drawn is what is known
 *
 * The clock says where the sun is, and nothing about the sky. So on the clock alone the sun or
 * moon is printed in OUTLINE, at its place on the day's arc, and no cloud, rain or star is drawn:
 * a clear sky nobody read would be a guess (`@/lib/weather` has the argument). Once the reader
 * asks for the weather, the body is inked in or hidden behind cloud, and the sky is printed.
 */

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { TitleWeather } from "@/components/useTitleWeather.ts";
import { courseAt, type Scene, type Sky, WeatherRefused } from "@/lib/weather.ts";
import { useUiStore } from "@/store.ts";

/** The drawn layers each sky prints, back to front, in pairs of far and near where it has depth. */
const LAYERS: Readonly<Record<Sky, readonly string[]>> = {
  clear: [],
  cloud: ["cloud cloud--far", "cloud"],
  fog: ["fog fog--far", "fog"],
  drizzle: ["cloud cloud--far", "cloud", "rain rain--far", "rain"],
  rain: ["cloud cloud--far", "cloud", "rain rain--far", "rain"],
  storm: ["cloud cloud--far", "cloud", "rain rain--far", "rain", "flash"],
  snow: ["cloud cloud--far", "cloud", "snow snow--far", "snow"],
};

/** Clear nights print their stars; a sky nobody read prints none. */
function layersOf({ light, sky, cold }: Scene): string[] {
  const stars = light === "night" && sky === "clear" ? ["stars", "stars stars--late"] : [];
  const sheet = sky === null ? [] : LAYERS[sky];
  return [...stars, ...sheet, ...(cold ? ["frost"] : [])];
}

/** The body shows through a clear sky, through fog as an outline, and not through cloud. */
function bodyShows(sky: Sky | null): boolean {
  return sky === null || sky === "clear" || sky === "fog";
}

/**
 * A point on the course, in percent of the arc's band: left at the rising, highest at the
 * middle of the course, right at the setting. A drawing of the hour, never printed as a time.
 */
function pointOn(along: number): { x: number; y: number } {
  return { x: 8 + along * 84, y: 86 - Math.sin(along * Math.PI) * 72 };
}

/** The whole course as a ruled hairline, the track the body travels along. */
const COURSE = Array.from({ length: 33 }, (_, index) => {
  const { x, y } = pointOn(index / 32);
  return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
}).join("");

/** The board's drawn layers. Presentation only: hidden from assistive technology. */
export function WeatherBoard({ scene, now }: { scene: Scene; now: Date }): React.JSX.Element {
  const lit = scene.sky === "clear";
  const { x, y } = pointOn(courseAt(now, scene.light));
  return (
    // Keyed by the scene so a change of weather is a new sheet inking in, not a mutation.
    <div
      className="weather"
      aria-hidden="true"
      key={`${scene.light}:${scene.sky ?? "unread"}:${scene.cold}`}
    >
      {/* The band the sun or moon travels in: the whole board on a wide screen, the strip above
          the leaf on a phone, where the leaf would otherwise cover it at every hour. */}
      {bodyShows(scene.sky) ? (
        <div className="weather__arc">
          {scene.sky === null ? (
            <svg
              className="weather__course"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d={COURSE} />
            </svg>
          ) : null}
          <div
            className="weather__body"
            style={{ left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%` }}
          >
            {scene.light === "night" ? <Moon lit={lit} /> : <Sun lit={lit} />}
          </div>
        </div>
      ) : null}
      {/* The sheet stands still and is calm where the leaf lies; only its layers move. */}
      <div className="weather__sheet">
        {layersOf(scene).map((layer) => (
          <div
            key={layer}
            className={layer
              .split(" ")
              .map((name) => `weather__${name}`)
              .join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

const RAYS = Array.from({ length: 24 }, (_, index) => {
  const angle = (index * Math.PI) / 12;
  const outer = index % 2 === 0 ? 74 : 64;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return `M${(54 * cos).toFixed(2)} ${(54 * sin).toFixed(2)}L${(outer * cos).toFixed(2)} ${(outer * sin).toFixed(2)}`;
}).join("");

function Sun({ lit }: { lit: boolean }): React.JSX.Element {
  return (
    <svg className="weather__sun" viewBox="-80 -80 160 160" data-lit={lit} aria-hidden="true">
      {/* Unlit, the rays are drawn in outline and stand still: the sun is up, the sky unread. */}
      <path className="weather__rays" d={RAYS} />
      <circle className="weather__disc" r="42" />
    </svg>
  );
}

function Moon({ lit }: { lit: boolean }): React.JSX.Element {
  return (
    <svg className="weather__moon" viewBox="-80 -80 160 160" data-lit={lit} aria-hidden="true">
      {/* A crescent: the outer limb, then the terminator back as a shallower arc. */}
      <path className="weather__disc" d="M14 -35.3A38 38 0 1 0 14 35.3A40 40 0 0 1 14 -35.3Z" />
    </svg>
  );
}

/**
 * The line beneath the leaf that says what the board is printing and on what evidence, and the
 * one plate that changes it. The consent is stated beside the plate, before the browser asks.
 */
export function Almanac({ weather }: { weather: TitleWeather }): React.JSX.Element {
  const { t } = useTranslation();
  const setWanted = useUiStore((state) => state.setWeatherWanted);
  const { wanted, reading } = weather;
  const refusal = reading.error instanceof WeatherRefused ? reading.error.reason : null;

  return (
    <section className="almanac" aria-label={t("signIn.weather.head")}>
      <div className="almanac__line">
        <span className="label almanac__head">{t("signIn.weather.head")}</span>
        <span className="datum almanac__datum" role="status">
          {readingText(t, weather)}
        </span>
        <span className="almanac__plates">
          {/* After a refusal the page is already on the clock, so the action worth offering
              is another try; withdrawing stays beside it. */}
          {wanted && refusal !== null ? (
            <button
              className="plate plate--small"
              type="button"
              onClick={(): void => {
                void reading.refetch();
              }}
            >
              {t("signIn.retry")}
            </button>
          ) : null}
          <button
            className="plate plate--small"
            type="button"
            onClick={(): void => {
              setWanted(!wanted);
            }}
          >
            {wanted ? t("signIn.weather.off") : t("signIn.weather.offer")}
          </button>
        </span>
      </div>
      {wanted ? null : <p className="almanac__note">{t("signIn.weather.consent")}</p>}
      {wanted && refusal !== null ? (
        <p className="almanac__note">
          {t(refusal === "denied" ? "signIn.weather.denied" : "signIn.weather.unavailable")}
        </p>
      ) : null}
    </section>
  );
}

function readingText(t: TFunction, { scene, wanted, reading }: TitleWeather): string {
  const light = t(`signIn.weather.light.${scene.light}`);
  if (!wanted || reading.isError) {
    return t("signIn.weather.byClock", { light });
  }
  if (reading.data === undefined || scene.sky === null) {
    return t("signIn.weather.locating");
  }
  return t(scene.cold ? "signIn.weather.readingCold" : "signIn.weather.reading", {
    temperature: String(Math.round(reading.data.temperature)),
    sky: t(`signIn.weather.sky.${scene.sky}`),
    light,
  });
}
