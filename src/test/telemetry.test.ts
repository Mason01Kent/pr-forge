import * as assert from 'assert';
import { shouldEnableTelemetry } from '../telemetryPolicy';

describe('telemetry helpers', () => {
  it('disables telemetry when global telemetry is off', () => {
    assert.strictEqual(shouldEnableTelemetry(false, true), false);
  });

  it('disables telemetry when extension telemetry is off', () => {
    assert.strictEqual(shouldEnableTelemetry(true, false), false);
  });

  it('enables telemetry only when both gates are open', () => {
    assert.strictEqual(shouldEnableTelemetry(true, true), true);
  });
});
