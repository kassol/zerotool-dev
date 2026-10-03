// JSON Schema Validator — loads Ajv (draft 4 / 6 / 7 / 2019-09 / 2020-12), ajv-formats and
// js-yaml, then runs the engine. Used by json-schema-validator.worker.js and, when a worker
// cannot start, by the main-thread fallback in JsonSchemaValidatorTool.astro. Returns plain data
// that can cross a worker boundary. The compiled validator of the last schema is kept, so typing
// in the data box does not recompile the schema.
import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import AjvDraft04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import draft06Meta from 'ajv/dist/refs/json-schema-draft-06.json';
import yaml from 'js-yaml';
import { runValidation as run } from './json-schema-validator-engine.js';

const lib = { Ajv, Ajv2019, Ajv2020, AjvDraft04, addFormats, draft06Meta, yaml };
const cache = { key: null, built: null };

// input: { schemaText, dataText, extrasText, menu, formats }, T: the page's STRINGS
export function runValidation(input, T) {
  try {
    return { result: run(lib, input, T, cache) };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
}
