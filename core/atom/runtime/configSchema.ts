import { migrations } from "../../store/migrations";

/** Atom 首个正式 durable settings schema baseline；未来迁移版本继续复用上游 migrations 列表。 */
export const CONFIG_SCHEMA_VERSION = Math.max(
  1,
  ...migrations.map((migration) => migration.version),
);
