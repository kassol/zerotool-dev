// OpenAPI Validator — loads the parser, Ajv and the official schemas, then runs the engine.
// Used by openapi-validator.worker.js and, when a worker cannot start, by the main-thread
// fallback in OpenapiValidatorTool.astro. Returns plain data that can cross a worker boundary.
import jsyaml from 'js-yaml';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import swagger20 from '../../data/openapi-schemas/swagger-2.0.json';
import draft04 from '../../data/openapi-schemas/json-schema-draft-04.json';
import oas30 from '../../data/openapi-schemas/oas-3.0-2024-10-18.json';
import oas31 from '../../data/openapi-schemas/oas-3.1-2026-08-03.json';
import oas32 from '../../data/openapi-schemas/oas-3.2-2026-08-30.json';
import { validateProject } from './openapi-validator-engine.js';

const lib = {
  jsyaml, Ajv, Ajv2020, addFormats,
  schemas: { '2.0': swagger20, 'draft-04': draft04, '3.0': oas30, '3.1': oas31, '3.2': oas32 },
};

export function runValidation(input) {
  try {
    return { result: validateProject(input, lib) };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
}
