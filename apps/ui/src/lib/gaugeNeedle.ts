/**
 * The needle on a gauge: a Chart.js plugin that draws one line over a half doughnut.
 *
 * The gauge is a doughnut of two slices -- the value and the remainder to the maximum --
 * turned to a half circle; the needle is the reading, drawn from the centre of the arc at
 * the angle the value makes of the maximum. A factory rather than a shared instance, so
 * the reading rides in a closure and no plugin options need declaring on Chart.js's types.
 */

import type { Chart, Plugin } from "chart.js";

/** The plugin for one reading: `fraction` is 0..1 of the arc. */
export function needlePlugin(fraction: number, colour: string): Plugin<"doughnut"> {
  const clamped = Math.min(1, Math.max(0, fraction));
  return {
    id: "undercroft-needle",
    afterDatasetsDraw(chart: Chart<"doughnut">): void {
      const meta = chart.getDatasetMeta(0);
      const [arc] = meta.data;
      if (arc === undefined) {
        return;
      }
      const { x, y, outerRadius, innerRadius } = arc.getProps(
        ["x", "y", "outerRadius", "innerRadius"],
        true,
      );
      // A half circle from nine o'clock (left) to three o'clock (right): pi to 2 pi.
      const angle = Math.PI + clamped * Math.PI;
      const length = (outerRadius + innerRadius) / 2;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    },
  };
}
