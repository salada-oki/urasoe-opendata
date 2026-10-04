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
  trendReport,
  parseDistrictCsvText,
  districtRankingForMonth,
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

const TREND_CSV = `year_month,age,male,female,total,source_url
202301,0,40,40,80,x
202301,45,125,125,250,x
202301,55,130,130,260,x
202301,70,75,75,150,x
202301,80,45,45,90,x
202101,0,50,50,100,x
202101,45,150,150,300,x
202101,55,100,100,200,x
202101,70,75,75,150,x
202101,80,25,25,50,x
`;

test("trendReport compares the first and latest month regardless of row order", () => {
  const report = trendReport(parseCsvText(TREND_CSV));
  assert.equal(report.from, "202101");
  assert.equal(report.to, "202301");
  assert.equal(report.months, 24);
  // 24 months apart -> per-year pace is half the total change
  assert.deepEqual(report.generations, {
    child: { from: 100, to: 80, diff: -20, perYear: -10 },
    working: { from: 500, to: 510, diff: 10, perYear: 5 },
    elderly: { from: 200, to: 240, diff: 40, perYear: 20 },
    total: { from: 800, to: 830, diff: 30, perYear: 15 },
  });
  assert.equal(report.elderlyRate.from, 200 / 800);
  assert.equal(report.elderlyRate.to, 240 / 830);
});

test("trendReport breaks out age 0, 65-74 vs 75+, and 40s vs 50s", () => {
  const report = trendReport(parseCsvText(TREND_CSV));
  assert.deepEqual(report.age0, { from: 100, to: 80, diff: -20 });
  assert.deepEqual(report.youngOld, { from: 150, to: 150, diff: 0 });
  assert.deepEqual(report.oldOld, { from: 50, to: 90, diff: 40 });
  assert.deepEqual(report.forties, { from: 300, to: 250, diff: -50 });
  assert.deepEqual(report.fifties, { from: 200, to: 260, diff: 60 });
});

test("trendReport returns null when there is only one month", () => {
  const records = parseCsvText(TREND_CSV).filter((r) => r.year_month === "202101");
  assert.equal(trendReport(records), null);
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

const DISTRICT_CSV = `year_month,district,total,male,female,households,child,working,elderly
202301,仲間,100,50,50,40,20,60,20
202301,牧港,300,150,150,120,30,200,70
202301,キャンプキンザー,10,5,5,4,0,4,6
202302,仲間,101,50,51,40,20,61,20
`;

test("parseDistrictCsvText parses the normalized district file into typed records", () => {
  const records = parseDistrictCsvText(DISTRICT_CSV);
  assert.equal(records.length, 4);
  assert.deepEqual(records[0], {
    year_month: "202301",
    district: "仲間",
    total: 100,
    male: 50,
    female: 50,
    households: 40,
    child: 20,
    working: 60,
    elderly: 20,
  });
});

test("parseDistrictCsvText reads quoted values containing commas and quotes", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,"浦添,""テスト""団地",10,5,5,4,1,8,1
`;
  assert.equal(parseDistrictCsvText(csv)[0].district, '浦添,"テスト"団地');
});

test("parseDistrictCsvText skips rows with empty or non-numeric cells", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,仲間,,50,50,40,20,60,20
202301,牧港,x,150,150,120,30,200,70
202301,城間,10,5,5,4,1,8,1
`;
  assert.deepEqual(
    parseDistrictCsvText(csv).map((r) => r.district),
    ["城間"]
  );
});

test("parseDistrictCsvText returns [] when a required column is missing", () => {
  const csv = `year_month,district,total
202301,仲間,100
`;
  assert.deepEqual(parseDistrictCsvText(csv), []);
});

test("districtRankingForMonth sorts districts by total population, largest first", () => {
  const ranking = districtRankingForMonth(parseDistrictCsvText(DISTRICT_CSV), "202301", "total");
  assert.deepEqual(ranking, [
    { district: "牧港", value: 300, total: 300 },
    { district: "仲間", value: 100, total: 100 },
    { district: "キャンプキンザー", value: 10, total: 10 },
  ]);
});

test("districtRankingForMonth sorts by elderly rate and keeps each district's population", () => {
  const ranking = districtRankingForMonth(parseDistrictCsvText(DISTRICT_CSV), "202301", "elderlyRate");
  assert.deepEqual(
    ranking.map((r) => r.district),
    ["キャンプキンザー", "牧港", "仲間"]
  );
  assert.equal(ranking[0].value, 6 / 10);
  assert.equal(ranking[0].total, 10);
});

test("districtRankingForMonth breaks ties by district name", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,い地区,10,5,5,4,1,8,1
202301,あ地区,10,5,5,4,1,8,1
`;
  assert.deepEqual(
    districtRankingForMonth(parseDistrictCsvText(csv), "202301", "total").map((r) => r.district),
    ["あ地区", "い地区"]
  );
});

test("districtRankingForMonth leaves out zero-population districts when ranking by rate", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,空き地区,0,0,0,0,0,0,0
202301,仲間,10,5,5,4,1,8,1
`;
  assert.deepEqual(
    districtRankingForMonth(parseDistrictCsvText(csv), "202301", "elderlyRate").map((r) => r.district),
    ["仲間"]
  );
});

test("districtRankingForMonth returns [] for a month with no district data", () => {
  assert.deepEqual(districtRankingForMonth(parseDistrictCsvText(DISTRICT_CSV), "202212", "total"), []);
});

test("districtRankingForMonth rejects an unknown metric", () => {
  assert.throws(() => districtRankingForMonth([], "202301", "households"), /unknown metric/);
});
