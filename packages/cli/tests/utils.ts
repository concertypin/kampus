const ALLOWED_STRINGS = new Set([
    "then",
    "toJSON",
    "inspect",
    "constructor",
    "prototype",
    "asymmetricMatch",
    "nodeType",
    "valueOf",
    "$$typeof",
    "length",
]);

/**
 * Creates a proxy of type T from a partial object.
 * If missing properties are accessed, it throws an error.
 * Note that symbol properties are not checked and will be returned as-is.
 * Some default properties are always allowed (see {@link ALLOWED_STRINGS}).
 *
 * @param target - The partial object to create a proxy from.
 * @param allowed - A set of allowed property names that can be accessed without throwing.
 * @returns A proxy of type T.
 */
export function fragile<const T extends object>(
    target: Partial<T>,
    allowed: Set<string> | string[] = []
): T {
    if (Array.isArray(allowed)) {
        return fragile(target, new Set(allowed));
    }
    return new Proxy(target as T, {
        get(obj, prop, receiver) {
            if (typeof prop === "symbol") {
                return Reflect.get(obj, prop, receiver);
            }
            if (prop in obj) {
                return Reflect.get(obj, prop, receiver);
            }
            if (ALLOWED_STRINGS.has(prop)) {
                return Reflect.get(obj, prop, receiver);
            }
            if (allowed.has(prop)) {
                return Reflect.get(obj, prop, receiver);
            }
            throw new Error(`Property ${String(prop)} is missing`);
        },
    });
}
