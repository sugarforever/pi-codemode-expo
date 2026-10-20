/** Runs only inside QuickJS. No host imports or closures are available here. */
export function bootstrapRuntime(prelude, fingerprint) {
  "use strict";
  const data = globalThis.__startData;
  const emit = globalThis.__emit;
  const request = globalThis.__request;
  const finish = globalThis.__finish;
  for (const name of ["__startData", "__emit", "__request", "__finish"])
    delete globalThis[name];
  const stringify = JSON.stringify;
  const compile = (0, eval);
  const deterministic = data.deterministic;
  let now = deterministic ? deterministic.startedAt : 0;
  let current = 0;
  let nextSeq = 1;
  let issued = 0;
  let initialized = false;
  let finished = false;
  let api;
  const early = new Map();
  if (deterministic) {
    globalThis.performance = {
      now: () => now - deterministic.startedAt,
      timeOrigin: deterministic.startedAt,
    };
    delete globalThis.WeakRef;
    delete globalThis.FinalizationRegistry;
    const NativeDate = Date;
    const nativeParse = NativeDate.parse;
    function utcParse(value) {
      const text = String(value);
      if (/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d+)?)?)?$/.test(text)) {
        return nativeParse(text.includes("T") ? text + "Z" : text);
      }
      // Explicit offsets and named UTC/GMT zones keep their meaning; other legacy forms read UTC.
      return nativeParse(
        /(?:Z|GMT|UTC|[+-]\d\d:?\d\d)\s*$/i.test(text) ? text : text + " UTC",
      );
    }
    const nativeGetTime = NativeDate.prototype.getTime;
    function objectLike(value) {
      return (
        (typeof value === "object" && value !== null) ||
        typeof value === "function"
      );
    }
    function dateArgument(value) {
      if (!objectLike(value)) return value;
      // Date construction copies [[DateValue]] without invoking user coercion.
      try {
        return Reflect.apply(nativeGetTime, value, []);
      } catch {}
      const exotic = value[Symbol.toPrimitive];
      if (exotic !== undefined && exotic !== null) {
        if (typeof exotic !== "function")
          throw new TypeError("Invalid Date primitive conversion");
        const primitive = Reflect.apply(exotic, value, ["default"]);
        if (objectLike(primitive))
          throw new TypeError("Date conversion did not return a primitive");
        return primitive;
      }
      for (const name of ["valueOf", "toString"]) {
        const method = value[name];
        if (typeof method === "function") {
          const primitive = Reflect.apply(method, value, []);
          if (!objectLike(primitive)) return primitive;
        }
      }
      throw new TypeError("Date conversion did not return a primitive");
    }
    function VirtualDate(...args) {
      if (!new.target) return new NativeDate(now).toUTCString();
      let value;
      if (args.length === 0) value = now;
      else if (args.length > 1) value = NativeDate.UTC(...args);
      else {
        value = dateArgument(args[0]);
        if (typeof value === "string") value = utcParse(value);
      }
      return Reflect.construct(NativeDate, [value], new.target);
    }
    VirtualDate.prototype = NativeDate.prototype;
    Object.defineProperty(VirtualDate.prototype, "constructor", {
      value: VirtualDate,
      writable: true,
      configurable: true,
    });
    VirtualDate.now = () => now;
    VirtualDate.parse = utcParse;
    VirtualDate.UTC = NativeDate.UTC;
    for (const name of [
      "FullYear",
      "Month",
      "Date",
      "Day",
      "Hours",
      "Minutes",
      "Seconds",
      "Milliseconds",
    ]) {
      NativeDate.prototype["get" + name] =
        NativeDate.prototype["getUTC" + name];
      if (name !== "Day")
        NativeDate.prototype["set" + name] =
          NativeDate.prototype["setUTC" + name];
    }
    NativeDate.prototype.getTimezoneOffset = function () {
      return Number.isNaN(this.getTime()) ? NaN : 0;
    };
    NativeDate.prototype.getYear = function () {
      return this.getUTCFullYear() - 1900;
    };
    NativeDate.prototype.setYear = function (year) {
      year = Number(year);
      return this.setUTCFullYear(year >= 0 && year <= 99 ? year + 1900 : year);
    };
    NativeDate.prototype.toString = NativeDate.prototype.toUTCString;
    NativeDate.prototype.toDateString = function () {
      return this.toUTCString().slice(0, 16);
    };
    NativeDate.prototype.toTimeString = function () {
      return this.toUTCString().slice(17);
    };
    NativeDate.prototype.toLocaleString = NativeDate.prototype.toUTCString;
    NativeDate.prototype.toLocaleDateString = NativeDate.prototype.toDateString;
    NativeDate.prototype.toLocaleTimeString = NativeDate.prototype.toTimeString;
    globalThis.Date = VirtualDate;
    let state = deterministic.seed >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  function bridge(kind, a, b, c) {
    if (finished) return;
    if (kind === "call" || kind === "global") {
      issued++;
      request(
        a,
        stringify({
          type: "call",
          id: a,
          target: kind === "call" ? "tool" : "global",
          name: b,
          ...(c === undefined ? {} : { args: c }),
        }),
      );
    } else if (kind === "output") {
      emit(
        stringify({
          type: "output",
          item:
            a === "image"
              ? { type: "image", data: b, mimeType: c }
              : {
                  type: "text",
                  text: b,
                  ...(a === "console" ? { console: true } : {}),
                },
        }),
      );
    } else if (kind === "done") {
      finished = true;
      finish(
        stringify({
          type: "done",
          ok: a,
          ...(a ? { value: b, writes: c } : { error: b }),
          ...(deterministic ? { during: { seq: current, issued } } : {}),
        }),
      );
    }
  }
  function apply(message) {
    api.settle(message.id, message.ok, message.payload, message.properties);
  }
  globalThis.__receive = (message) => {
    if (finished) return;
    if (!deterministic) {
      apply(message);
      return;
    }
    if (
      !Number.isSafeInteger(message.seq) ||
      message.seq < nextSeq ||
      early.has(message.seq) ||
      !Number.isFinite(message.now)
    )
      throw new Error("Invalid deterministic result sequence/time");
    early.set(message.seq, message);
  };
  globalThis.__drain = () => {
    if (finished) return false;
    if (!initialized) {
      initialized = true;
      api = prelude(
        bridge,
        stringify(data.tools),
        stringify(data.globals),
        stringify(data.store),
      );
      if (deterministic) emit(stringify({ type: "started", fingerprint }));
      try {
        api.run(compile("(async (tools, console) => {" + data.code + "\n})"));
      } catch (error) {
        bridge(
          "done",
          false,
          stringify({
            name: error.name,
            message: error.message,
            stack: error.stack,
          }),
        );
      }
      return !finished;
    }
    api.stalled();
    if (finished) return false;
    if (deterministic) {
      // Every pass is a complete job drain; exactly one idle per processed seq.
      if (current === nextSeq - 1) {
        emit(stringify({ type: "idle", seq: current, issued }));
        current = -1;
      }
      const message = early.get(nextSeq);
      if (message) {
        early.delete(nextSeq);
        current = nextSeq++;
        now = Math.max(now, message.now);
        apply(message);
        return true;
      }
    }
    return false;
  };
}
