/**
 * Schema-name validation, in a leaf module on purpose.
 *
 * This lived in `config.ts` until `telemetryRetention.ts` needed it, which made the two import
 * each other — and that cycle was not merely untidy. `config.ts` builds
 * `DEFAULT_TELEMETRY_RETENTION_SETTINGS` at module scope from a const in `telemetryRetention.ts`,
 * so any entry point reaching the retention module first began evaluating config, hit that const
 * in its temporal dead zone, and threw `Cannot access 'DEFAULT_TELEMETRY_RETENTION' before
 * initialization` at startup. The whole suite passed regardless, because vitest happened to load
 * `config` first everywhere.
 *
 * Nothing may be imported here. That is the property that keeps the cycle from coming back.
 */

/**
 * Schema names are interpolated directly into DDL (`CREATE SCHEMA "<name>"`,
 * `SET LOCAL search_path TO "<name>"`) because Postgres has no parameterized-identifier
 * placeholder. This is the only thing standing between a config value and SQL injection
 * into the search path, so it is deliberately strict: lowercase ASCII, digits, and
 * underscores only, not starting with a digit.
 */
const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function assertValidSchemaName(schemaName: string): void {
  if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
    throw new Error(
      `Invalid database schemaName "${schemaName}": expected lowercase letters, digits, and underscores, not starting with a digit.`,
    );
  }
}
