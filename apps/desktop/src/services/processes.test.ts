import { describe, expect, it } from "bun:test";
import { processRunner } from "@undercroft/setup";
import { processGroup } from "./processes.ts";

/** Over real programs: what the quit in `main.ts` asks of the group, and waits on. */
describe("processGroup", () => {
  it("reports nothing running once a program has ended by itself", async () => {
    const processes = processGroup(processRunner);
    const result = await processes.run("sh", ["-c", "exit 0"]);
    expect(result.code).toBe(0);
    // A group that still thought so would hold back every quit from then on.
    expect(processes.running()).toBe(false);
  });

  it("stops what is running and resolves only once it has exited", async () => {
    const processes = processGroup(processRunner);
    let exited = false;
    const run = processes.run("sleep", ["30"]).then((result) => {
      exited = true;
      return result;
    });
    expect(processes.running()).toBe(true);

    await processes.stop();

    expect(exited).toBe(true);
    expect((await run).code).not.toBe(0);
    expect(processes.running()).toBe(false);
  });
});
