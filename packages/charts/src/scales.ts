type NumericScale = ((value: number) => number) & {
  copy: () => NumericScale;
  domain: {
    (): readonly number[];
    (values: Iterable<number>): NumericScale;
  };
  range: (values: Iterable<number>) => NumericScale;
  ticks: (count?: number) => readonly number[];
  tickFormat: (count?: number) => (value: number) => string;
  nice: (count?: number) => NumericScale;
};

type BandScale<T> = ((value: T) => number | undefined) & {
  copy: () => BandScale<T>;
  domain: {
    (): readonly T[];
    (values: Iterable<T>): BandScale<T>;
  };
  range: (values: Iterable<number>) => BandScale<T>;
  bandwidth: () => number;
  padding: {
    (): number;
    (value: number): BandScale<T>;
  };
  paddingInner: {
    (): number;
    (value: number): BandScale<T>;
  };
  paddingOuter: {
    (): number;
    (value: number): BandScale<T>;
  };
  ticks: (count?: number) => readonly T[];
  tickFormat: (count?: number) => (value: T) => string;
};

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  const normalized = raw / magnitude;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return factor * magnitude;
}

function numericTicks(domain: readonly number[], count: number): number[] {
  const [first = 0, last = 1] = domain;
  if (first === last) return [first];
  const reverse = first > last;
  const lo = reverse ? last : first;
  const hi = reverse ? first : last;
  const step = niceStep(hi - lo, count);
  const start = Math.ceil(lo / step) * step;
  const values: number[] = [];
  for (let value = start; value <= hi + step * 1e-8; value += step) {
    values.push(Number(value.toPrecision(12)));
  }
  return reverse ? values.reverse() : values;
}

function formatTick(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(3)));
}

export function scaleLinear(): NumericScale {
  let domain: [number, number] = [0, 1];
  let outputRange: [number, number] = [0, 1];

  const scale = ((value: number) => {
    const [domainStart, domainEnd] = domain;
    const [rangeStart, rangeEnd] = outputRange;
    if (domainStart === domainEnd) return (rangeStart + rangeEnd) / 2;
    const ratio = (value - domainStart) / (domainEnd - domainStart);
    return rangeStart + ratio * (rangeEnd - rangeStart);
  }) as NumericScale;

  scale.domain = ((values?: Iterable<number>) => {
    if (values === undefined) return domain;
    const next = [...values];
    domain = [next[0] ?? 0, next[1] ?? next[0] ?? 1];
    return scale;
  }) as NumericScale['domain'];
  scale.range = (values) => {
    const next = [...values];
    outputRange = [next[0] ?? 0, next[1] ?? next[0] ?? 1];
    return scale;
  };
  scale.copy = () => {
    const copy = scaleLinear();
    copy.domain(domain);
    copy.range(outputRange);
    return copy;
  };
  scale.ticks = (count = 5) => numericTicks(domain, count);
  scale.tickFormat = () => formatTick;
  scale.nice = (count = 5) => {
    const [first = 0, last = 1] = domain;
    if (first === last) return scale;
    const step = niceStep(Math.abs(last - first), count);
    const lo = Math.floor(Math.min(first, last) / step) * step;
    const hi = Math.ceil(Math.max(first, last) / step) * step;
    domain = first <= last ? [lo, hi] : [hi, lo];
    return scale;
  };
  return scale;
}

export function scaleBand<T>(): BandScale<T> {
  let values: T[] = [];
  let outputRange: [number, number] = [0, 1];
  let inner = 0;
  let outer = 0;

  const scale = ((value: T) => {
    const index = values.indexOf(value);
    if (index < 0) return undefined;
    const [rangeStart, rangeEnd] = outputRange;
    const direction = rangeEnd >= rangeStart ? 1 : -1;
    const span = Math.abs(rangeEnd - rangeStart);
    const step = span / Math.max(1, values.length - inner + outer * 2);
    const offset = (span - step * (values.length - inner)) / 2;
    return rangeStart + direction * (offset + index * step);
  }) as BandScale<T>;

  scale.domain = ((next?: Iterable<T>) => {
    if (next === undefined) return values;
    values = unique(next);
    return scale;
  }) as BandScale<T>['domain'];
  scale.range = (next) => {
    const range = [...next];
    outputRange = [range[0] ?? 0, range[1] ?? range[0] ?? 1];
    return scale;
  };
  scale.bandwidth = () => {
    const span = Math.abs(outputRange[1] - outputRange[0]);
    const step = span / Math.max(1, values.length - inner + outer * 2);
    return step * Math.max(0, 1 - inner);
  };
  scale.padding = ((value?: number) => {
    if (value === undefined) return Math.max(inner, outer);
    inner = Math.min(1, Math.max(0, value));
    outer = Math.max(0, value);
    return scale;
  }) as BandScale<T>['padding'];
  scale.paddingInner = ((value?: number) => {
    if (value === undefined) return inner;
    inner = Math.min(1, Math.max(0, value));
    return scale;
  }) as BandScale<T>['paddingInner'];
  scale.paddingOuter = ((value?: number) => {
    if (value === undefined) return outer;
    outer = Math.max(0, value);
    return scale;
  }) as BandScale<T>['paddingOuter'];
  scale.ticks = () => values;
  scale.tickFormat = () => (value) => String(value);
  scale.copy = () => {
    const copy = scaleBand<T>();
    copy.domain(values);
    copy.range(outputRange);
    copy.paddingInner(inner);
    copy.paddingOuter(outer);
    return copy;
  };
  return scale;
}
