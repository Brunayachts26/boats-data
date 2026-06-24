const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.BOATS_API_KEY;
if (!API_KEY) {
  console.error("BOATS_API_KEY environment variable is required");
  process.exit(1);
}
const BASE_URL = "https://api.boats.com/inventory/search";
const DATA_DIR = path.join(__dirname, "docs");

const STATUSES = ["Active", "on-order", "sale pending", "Inactive"];

async function fetchAllPages(page, status) {
  const rows = 50;
  let offset = 0;
  let allResults = [];
  let totalResults = 0;

  while (true) {
    const url = `${BASE_URL}?key=${API_KEY}&SalesStatus=${encodeURIComponent(status)}&rows=${rows}&offset=${offset}&sort=ModelYear|desc`;

    console.log(`  Fetching offset=${offset}...`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    const jsonText = await page.evaluate(() => document.body.innerText);

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      console.log(`  Warning: non-JSON response at offset ${offset}, retrying once...`);
      await page.waitForTimeout(3000);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      const retryText = await page.evaluate(() => document.body.innerText);
      try {
        data = JSON.parse(retryText);
      } catch (e2) {
        console.log(`  Failed to parse JSON after retry. Stopping.`);
        break;
      }
    }

    if (!data.results || data.results.length === 0) break;

    totalResults = data.numResults || totalResults;
    allResults = allResults.concat(data.results);
    console.log(`  Got ${data.results.length} results (total so far: ${allResults.length}/${totalResults})`);

    if (allResults.length >= totalResults) break;
    offset += rows;
  }

  return { numResults: totalResults, results: allResults };
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  );

  for (const status of STATUSES) {
    const filename = status.toLowerCase().replace(/\s+/g, "-") + ".json";
    console.log(`\nFetching status: ${status} -> ${filename}`);

    try {
      const data = await fetchAllPages(page, status);
      const filePath = path.join(DATA_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  Saved ${data.results.length} listings to ${filename}`);
    } catch (err) {
      console.error(`  Error fetching ${status}:`, err.message);
      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({ numResults: 0, results: [] }));
      }
    }
  }

  const meta = {
    lastUpdated: new Date().toISOString(),
    statuses: STATUSES.map((s) => ({
      status: s,
      file: s.toLowerCase().replace(/\s+/g, "-") + ".json",
    })),
  };
  fs.writeFileSync(path.join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  await browser.close();
  console.log("\nDone! All data saved to /data");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
