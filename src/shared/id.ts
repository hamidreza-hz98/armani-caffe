declare const entityIdBrand: unique symbol;

export type EntityId = string & { readonly [entityIdBrand]: true };

export function parseEntityId(value: string): EntityId {
  if (!/^[0-9a-fA-F]{24}$/.test(value)) {
    throw new Error("Entity ID must be a 24-character hexadecimal string");
  }
  return value.toLowerCase() as EntityId;
}
