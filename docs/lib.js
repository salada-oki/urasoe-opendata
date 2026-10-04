export function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",");
  const idx = {
    year_month: header.indexOf("year_month"),
    age: header.indexOf("age"),
    male: header.indexOf("male"),
    female: header.indexOf("female"),
    total: header.indexOf("total"),
  };
  if (idx.year_month === -1 || idx.age === -1 || idx.male === -1 || idx.female === -1 || idx.total === -1) {
    console.warn("parseCsvText: missing required column in header");
    return [];
  }
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const year_month = cols[idx.year_month];
    const age = Number(cols[idx.age]);
    const male = Number(cols[idx.male]);
    const female = Number(cols[idx.female]);
    const total = Number(cols[idx.total]);
    if (
      typeof year_month !== "string" ||
      year_month === "" ||
      !Number.isFinite(age) ||
      !Number.isFinite(male) ||
      !Number.isFinite(female) ||
      !Number.isFinite(total)
    ) {
      console.warn(`skipping unparseable row: ${lines[i]}`);
      continue;
    }
    records.push({ year_month, age, male, female, total });
  }
  return records;
}

export function listYearMonths(records) {
  const set = new Set(records.map((r) => r.year_month));
  return Array.from(set).sort();
}

export function pyramidDataForMonth(records, ym) {
  const rows = records
    .filter((r) => r.year_month === ym)
    .slice()
    .sort((a, b) => a.age - b.age);
  return {
    ages: rows.map((r) => r.age),
    male: rows.map((r) => r.male),
    female: rows.map((r) => r.female),
  };
}

const DECADE_LABELS = [
  "0-9", "10-19", "20-29", "30-39", "40-49",
  "50-59", "60-69", "70-79", "80-89", "90-99", "100+",
];

function decadeLabelOf(age) {
  if (age >= 100) return "100+";
  const start = Math.floor(age / 10) * 10;
  return `${start}-${start + 9}`;
}

export function pyramidDataByDecade(records, ym) {
  const rows = records.filter((r) => r.year_month === ym);
  if (rows.length === 0) return { ages: [], male: [], female: [] };
  const buckets = new Map(DECADE_LABELS.map((label) => [label, { male: 0, female: 0 }]));
  for (const r of rows) {
    const bucket = buckets.get(decadeLabelOf(r.age));
    bucket.male += r.male;
    bucket.female += r.female;
  }
  return {
    ages: DECADE_LABELS,
    male: DECADE_LABELS.map((label) => buckets.get(label).male),
    female: DECADE_LABELS.map((label) => buckets.get(label).female),
  };
}

function ageGroupOf(age) {
  if (age <= 14) return "child";
  if (age <= 64) return "working";
  return "elderly";
}

export function ageGroupTotals(records) {
  const byMonth = new Map();
  for (const r of records) {
    if (!byMonth.has(r.year_month)) {
      byMonth.set(r.year_month, { year_month: r.year_month, child: 0, working: 0, elderly: 0, total: 0 });
    }
    const bucket = byMonth.get(r.year_month);
    bucket[ageGroupOf(r.age)] += r.total;
    bucket.total += r.total;
  }
  return Array.from(byMonth.values()).sort((a, b) => (a.year_month < b.year_month ? -1 : 1));
}

function niceStep(raw) {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw);
}

// Same tick step and same vertical span for every series, each positioned
// over its own values, so slopes are comparable across separately-drawn charts.
export function sharedScaleRanges(totals, keys, targetTicks = 5) {
  const extents = keys.map((key) => {
    const values = totals.map((t) => t[key]);
    return { key, min: Math.min(...values), max: Math.max(...values) };
  });
  const maxSpan = Math.max(...extents.map((e) => e.max - e.min));
  const step = niceStep(Math.max(maxSpan / targetTicks, 1));
  const steps = Math.max(
    1,
    ...extents.map((e) => Math.ceil(e.max / step) - Math.floor(e.min / step))
  );
  const ranges = {};
  for (const e of extents) {
    const min = Math.floor(e.min / step) * step;
    ranges[e.key] = { min, max: min + steps * step };
  }
  return { step, ranges };
}

function monthsBetween(fromYm, toYm) {
  const toIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6));
  return toIndex(toYm) - toIndex(fromYm);
}

function sumAges(records, ym, lo, hi) {
  return records
    .filter((r) => r.year_month === ym && r.age >= lo && r.age <= hi)
    .reduce((sum, r) => sum + r.total, 0);
}

export function trendReport(records) {
  const months = listYearMonths(records);
  if (months.length < 2) return null;
  const from = months[0];
  const to = months[months.length - 1];
  const span = monthsBetween(from, to);

  const totals = ageGroupTotals(records);
  const first = totals.find((t) => t.year_month === from);
  const last = totals.find((t) => t.year_month === to);
  const generations = {};
  for (const key of ["child", "working", "elderly", "total"]) {
    const diff = last[key] - first[key];
    generations[key] = { from: first[key], to: last[key], diff, perYear: Math.round((diff / span) * 12) };
  }

  const compare = (lo, hi) => {
    const a = sumAges(records, from, lo, hi);
    const b = sumAges(records, to, lo, hi);
    return { from: a, to: b, diff: b - a };
  };

  return {
    from,
    to,
    months: span,
    generations,
    elderlyRate: { from: first.elderly / first.total, to: last.elderly / last.total },
    age0: compare(0, 0),
    youngOld: compare(65, 74),
    oldOld: compare(75, Infinity),
    forties: compare(40, 49),
    fifties: compare(50, 59),
  };
}

export function summaryForMonth(records, ym) {
  const rows = records.filter((r) => r.year_month === ym);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const elderly = rows.filter((r) => r.age >= 65).reduce((sum, r) => sum + r.total, 0);
  return { total, elderlyRate: elderly / total };
}

const DISTRICT_NUMERIC_FIELDS = ["total", "male", "female", "households", "child", "working", "elderly"];

// Python's csv module quotes a value only when it contains a comma, quote or
// newline; this handles that quoting ("" is an escaped quote).
function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

const toNumber = (s) => (s === undefined || s.trim() === "" ? NaN : Number(s));

export function parseDistrictCsvText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const fields = ["year_month", "district", ...DISTRICT_NUMERIC_FIELDS];
  const idx = Object.fromEntries(fields.map((f) => [f, header.indexOf(f)]));
  if (fields.some((f) => idx[f] === -1)) {
    console.warn("parseDistrictCsvText: missing required column in header");
    return [];
  }
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const record = {
      year_month: (cols[idx.year_month] ?? "").trim(),
      district: (cols[idx.district] ?? "").trim(),
    };
    for (const f of DISTRICT_NUMERIC_FIELDS) record[f] = toNumber(cols[idx[f]]);
    if (!record.year_month || !record.district || DISTRICT_NUMERIC_FIELDS.some((f) => !Number.isFinite(record[f]))) {
      console.warn(`skipping unparseable district row: ${lines[i]}`);
      continue;
    }
    records.push(record);
  }
  return records;
}

export function districtRankingForMonth(records, ym, metric) {
  if (metric !== "total" && metric !== "elderlyRate") throw new Error(`unknown metric: ${metric}`);
  return records
    .filter((r) => r.year_month === ym && (metric === "total" || r.total > 0))
    .map((r) => ({
      district: r.district,
      value: metric === "total" ? r.total : r.elderly / r.total,
      total: r.total,
    }))
    .sort((a, b) => b.value - a.value || a.district.localeCompare(b.district, "ja"));
}
