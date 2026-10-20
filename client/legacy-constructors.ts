export function callableConstructor<T extends Function>(base: T): T {
  return new Proxy(base, {
    apply(target, receiver, argumentsList) {
      if (!receiver || !Object.prototype.isPrototypeOf.call(target.prototype, receiver)) {
        throw new TypeError("A legacy superclass call requires an instance of its shared base class.");
      }
      const derived: unknown = Reflect.get(receiver, "constructor");
      if (typeof derived !== "function") { throw new TypeError("A legacy subclass must have a constructor."); }
      // Construct the returned subclass instance rather than copying fields and losing private brands.
      return Reflect.construct(target, argumentsList, derived);
    },
  });
}
