import assert from "node:assert/strict";
import test from "node:test";

import { applyDeploymentCommand } from "./apply.mjs";
import { inspectDeploymentCommand } from "./inspect.mjs";
import { planDeploymentCommand } from "./plan.mjs";
import { rollbackDeploymentCommand } from "./rollback.mjs";

function capture() {
  const lines = [];
  return {
    lines,
    write: (line) => lines.push(line),
  };
}

test("plan is delegated without calling an apply boundary", async () => {
  const output = capture();
  let applies = 0;
  const result = await planDeploymentCommand({
    lifecycle: {
      plan: () => ({
        schemaVersion: 1,
        providerName: "VERCEL",
        actions: [],
        externalDnsMutation: false,
      }),
      apply: () => {
        applies += 1;
      },
    },
    intent: Object.freeze({}),
    write: output.write,
  });

  assert.equal(applies, 0);
  assert.equal(result.externalDnsMutation, false);
  assert.deepEqual(JSON.parse(output.lines[0]), result);
});

test("apply emits only its closed lifecycle result", async () => {
  const output = capture();
  const result = await applyDeploymentCommand({
    lifecycle: {
      apply: async () => ({
        success: false,
        error: {
          code: "PROVIDER_REJECTED",
          message: "Deployment provider rejected the request",
          retryable: false,
          attempts: 1,
        },
      }),
    },
    intent: Object.freeze({}),
    write: output.write,
  });

  assert.deepEqual(JSON.parse(output.lines[0]), result);
  assert.equal(output.lines[0].includes("payload"), false);
});

test("inspect and rollback delegate to separate lifecycle boundaries", async () => {
  const inspectionOutput = capture();
  const rollbackOutput = capture();
  const lifecycle = {
    inspect: async () => ({ success: true, state: { domains: [] } }),
    rollback: async () => ({
      success: true,
      providerDeploymentId: "dpl_fixture",
    }),
  };

  const inspection = await inspectDeploymentCommand({
    lifecycle,
    intent: Object.freeze({}),
    observation: Object.freeze({}),
    write: inspectionOutput.write,
  });
  const rollback = await rollbackDeploymentCommand({
    lifecycle,
    intent: Object.freeze({}),
    target: Object.freeze({}),
    write: rollbackOutput.write,
  });

  assert.equal(inspection.success, true);
  assert.equal(rollback.success, true);
  assert.deepEqual(JSON.parse(inspectionOutput.lines[0]), inspection);
  assert.deepEqual(JSON.parse(rollbackOutput.lines[0]), rollback);
});

test("thrown errors are replaced by one stable secret-free failure", async () => {
  const output = capture();
  const secret = "transport-secret-must-not-escape";
  const result = await applyDeploymentCommand({
    lifecycle: {
      apply: async () => {
        throw new Error(`Authorization: Bearer ${secret}`);
      },
    },
    intent: Object.freeze({}),
    write: output.write,
  });

  assert.deepEqual(result, {
    success: false,
    error: {
      code: "COMMAND_FAILED",
      message: "Deployment command failed",
    },
  });
  assert.equal(output.lines[0].includes(secret), false);
  assert.equal(output.lines[0].includes("Authorization"), false);
});
