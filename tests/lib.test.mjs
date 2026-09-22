import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsvText,
  listYearMonths,
  pyramidDataForMonth,
  ageGroupTotals,
  summaryForMonth,
} from "../docs/lib.js";

const SAMPLE_CSV = `year_month,age,male,female,total,source_url
202401,0,50,48,98,https://example.com/a.pdf
202401,1,52,49,101,https://example.com/a.pdf
202401,15,60,58,118,https://example.com/a.pdf
202401,65,30,35,65,https://example.com/a.pdf
202402,0,49,47,96,https://example.com/b.pdf
202402,1,53,50,103,https://example.com/b.pdf
202402,15,61,59,120,https://example.com/b.pdf
202402,65,31,36,67,https://example.com/b.pdf
`;

test("parseCsvText parses rows into typed records", () => {
  const records = parseCsvText(SAMPLE_CSV);
  assert.equal(records.length, 8);
  assert.deepEqual(records[0], {
    year_month: "202401",
    age: 0,
    male: 50,
    female: 48,
    total: 98,
  });
});

test("parseCsvText ignores blank trailing lines", () => {
  const records = parseCsvText(SAMPLE_CSV + "\n\n");
  assert.equal(records.length, 8);
});

test("listYearMonths returns sorted unique year_months", () => {
  const records = parseCsvText(SAMPLE_CSV);
  assert.deepEqual(listYearMonths(records), ["202401", "202402"]);
});

test("pyramidDataForMonth filters and sorts by age for the given month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = pyramidDataForMonth(records, "202401");
  assert.deepEqual(result, {
    ages: [0, 1, 15, 65],
    male: [50, 52, 60, 30],
    female: [48, 49, 58, 35],
  });
});

test("pyramidDataForMonth returns empty arrays for unknown month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = pyramidDataForMonth(records, "209912");
  assert.deepEqual(result, { ages: [], male: [], female: [] });
});

test("ageGroupTotals aggregates into child/working/elderly buckets per month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = ageGroupTotals(records);
  assert.deepEqual(result, [
    { year_month: "202401", child: 199, working: 118, elderly: 65, total: 382 },
    { year_month: "202402", child: 199, working: 120, elderly: 67, total: 386 },
  ]);
});

test("summaryForMonth returns total and elderly rate", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = summaryForMonth(records, "202401");
  assert.equal(result.total, 382);
  assert.ok(Math.abs(result.elderlyRate - 65 / 382) < 1e-9);
});

test("summaryForMonth returns null for unknown month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  assert.equal(summaryForMonth(records, "209912"), null);
});
