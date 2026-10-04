import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsvText,
  listYearMonths,
  pyramidDataForMonth,
  pyramidDataByDecade,
  ageGroupTotals,
  summaryForMonth,
  sharedScaleRanges,
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

test("pyramidDataByDecade buckets ages into fixed 10-year labels for the given month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = pyramidDataByDecade(records, "202401");
  assert.deepEqual(result.ages, [
    "0-9", "10-19", "20-29", "30-39", "40-49",
    "50-59", "60-69", "70-79", "80-89", "90-99", "100+",
  ]);
  // age0(50/48) + age1(52/49) -> "0-9"; age15(60/58) -> "10-19"; age65(30/35) -> "60-69"
  assert.deepEqual(result.male, [102, 60, 0, 0, 0, 0, 30, 0, 0, 0, 0]);
  assert.deepEqual(result.female, [97, 58, 0, 0, 0, 0, 35, 0, 0, 0, 0]);
});

test("pyramidDataByDecade returns empty arrays for unknown month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = pyramidDataByDecade(records, "209912");
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

test("sharedScaleRanges gives every series the same step and the same span", () => {
  const totals = [
    { a: 100, b: 1000 },
    { a: 340, b: 1050 },
  ];
  // largest span is a (240) -> 240/5 = 48 -> nice step 50
  // a: 100..350 (5 steps), b: 1000..1050 (1 step) -> common span 5 steps = 250
  assert.deepEqual(sharedScaleRanges(totals, ["a", "b"]), {
    step: 50,
    ranges: {
      a: { min: 100, max: 350 },
      b: { min: 1000, max: 1250 },
    },
  });
});

test("sharedScaleRanges keeps at least one step when a series never changes", () => {
  const totals = [{ a: 500 }, { a: 500 }];
  const result = sharedScaleRanges(totals, ["a"]);
  assert.ok(result.ranges.a.max > result.ranges.a.min);
  assert.ok(result.ranges.a.min <= 500 && result.ranges.a.max >= 500);
});

test("summaryForMonth returns null for unknown month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  assert.equal(summaryForMonth(records, "209912"), null);
});

test("parseCsvText skips a row with a non-numeric cell and keeps other rows", () => {
  const csv = `year_month,age,male,female,total,source_url
202401,0,50,48,98,https://example.com/a.pdf
202401,not-a-number,52,49,101,https://example.com/a.pdf
202401,15,60,58,118,https://example.com/a.pdf
`;
  const records = parseCsvText(csv);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((r) => r.age),
    [0, 15]
  );
});

test("parseCsvText returns [] when the header is missing an expected column", () => {
  const csv = `year_month,age,male,female,source_url
202401,0,50,48,https://example.com/a.pdf
`;
  const records = parseCsvText(csv);
  assert.deepEqual(records, []);
});
