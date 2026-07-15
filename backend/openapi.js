import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
let cached;

export function getOpenApiDocument() {
  if (!cached) cached = YAML.parse(readFileSync(join(__dirname, '..', 'docs', 'openapi', 'doco-openapi-v1.yaml'), 'utf8'));
  return cached;
}
