// OpenAPI Validator worker — parses and validates off the main thread, so a 10 MB description
// does not freeze the page. Message in: { id, input: { root, files } }.
// Message out: { id, result } or { id, error } (see openapi-validator-run.js).
import { runValidation } from './openapi-validator-run.js';

self.onmessage = (event) => {
  const { id, input } = event.data || {};
  self.postMessage({ id, ...runValidation(input) });
};
