// JSON Schema Validator worker — parses and validates off the main thread, so a large data file
// does not freeze the page and a run can be stopped with terminate().
// Message in: { id, input, T }. Message out: { id, result } or { id, error }
// (see json-schema-validator-run.js).
import { runValidation } from './json-schema-validator-run.js';

self.onmessage = (event) => {
  const { id, input, T } = event.data || {};
  self.postMessage({ id, ...runValidation(input, T) });
};
