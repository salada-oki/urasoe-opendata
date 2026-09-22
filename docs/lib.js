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
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    records.push({
      year_month: cols[idx.year_month],
      age: Number(cols[idx.age]),
      male: Number(cols[idx.male]),
      female: Number(cols[idx.female]),
      total: Number(cols[idx.total]),
    });
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

export function summaryForMonth(records, ym) {
  const rows = records.filter((r) => r.year_month === ym);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const elderly = rows.filter((r) => r.age >= 65).reduce((sum, r) => sum + r.total, 0);
  return { total, elderlyRate: elderly / total };
}
