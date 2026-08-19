const fs = require('fs');

const UPSTOX_API = "https://service.upstox.com/nextgen-ipo/open/v1";
const UPSTOX_CONTENT = "https://service.upstox.com/content/open/v2";
const IPOWATCH_URL = "https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/";

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchDirect(url, isJson = true) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://upstox.com',
        'Referer': 'https://upstox.com/'
    };
    try {
        const res = await fetch(url, { headers });
        if (res.ok) {
            return isJson ? await res.json() : await res.text();
        }
    } catch (e) {
        console.error(`Fetch failed for ${url}:`, e.message);
    }
    return null;
}

async function runScraper() {
    console.log("Starting GitHub Actions Direct Scraper Engine...");
    const statuses = ["open", "upcoming", "closed", "listed"];
    let rawList = [];

    // 1. Fetch Upstox Discovery (Direct from Azure, No Proxies Needed)
    for (const status of statuses) {
        console.log(`Discovering [${status.toUpperCase()}] IPOs...`);
        const json = await fetchDirect(`${UPSTOX_API}/ipos?status=${status}`, true);
        
        let items = [];
        // CRASH-PROOF ARRAY EXTRACTION (Fixes the json.data.map error)
        if (json && json.data) {
            if (Array.isArray(json.data)) items = json.data;
            else if (Array.isArray(json.data.content)) items = json.data.content;
            else if (Array.isArray(json.data.list)) items = json.data.list;
            else if (Array.isArray(json.data.data)) items = json.data.data;
        } else if (Array.isArray(json)) {
            items = json;
        }

        if (items.length > 0) {
            rawList.push(...items.map(i => ({ ...i, _lifecycle: status.toUpperCase() })));
            console.log(`-> Found ${items.length} records for ${status}`);
        } else {
            console.log(`-> No records returned or format unknown for ${status}`);
        }
        await delay(500); // Polite delay to prevent rate limiting
    }

    if (rawList.length === 0) {
        console.error("CRITICAL ERROR: No records fetched at all.");
        return;
    }

    // Deduplicate
    const uniqueMap = new Map();
    rawList.forEach(item => {
        if (item.slug && !uniqueMap.has(item.slug)) uniqueMap.set(item.slug, item);
    });
    const uniqueList = Array.from(uniqueMap.values());
    console.log(`\nTotal Unique IPOs to process: ${uniqueList.length}`);

    // 2. Fetch GMP Sentiment
    console.log("Fetching GMP from IPOWatch...");
    let gmpIndex = [];
    const html = await fetchDirect(IPOWATCH_URL, false);
    if (html) {
        gmpIndex = parseIpoWatchHtml(html);
        console.log(`-> Found ${gmpIndex.length} GMP records`);
    }

    // 3. Enrich
    const finalRecords = [];
    let count = 0;

    for (const item of uniqueList) {
        count++;
        let content = null;
        const status = item._lifecycle === "OPEN" ? "LIVE" : item._lifecycle;

        // Fetch deep details for LIVE & UPCOMING
        if (status === "LIVE" || status === "UPCOMING") {
            console.log(`[${count}/${uniqueList.length}] Deep fetch for: ${item.slug}`);
            const cJson = await fetchDirect(`${UPSTOX_CONTENT}/ipo/slug/${item.slug}`, true);
            if (cJson && cJson.data) content = cJson.data;
            await delay(300);
        } else {
            if (count % 10 === 0) console.log(`[${count}/${uniqueList.length}] Processed historic IPOs...`);
        }

        const minP = content?.minPrice || item.minPrice || null;
        const maxP = content?.maxPrice || item.maxPrice || null;
        const gmpMatch = matchGmp(item.companyName || item.name, gmpIndex);

        finalRecords.push({
            symbol: item.symbol || content?.symbol || null,
            type: item.series === "SME" || item.type === "SME" ? "SME" : "Mainboard",
            name: item.companyName || item.name,
            detailsUrl: `https://upstox.com/ipo/${item.slug}/`,
            logoUrl: item.logoUrl || content?.logoUrl || `https://groww.in/z-connect/wp-content/uploads/2026/08/${item.slug}-logo.png`,
            priceRange: (minP && maxP) ? `₹${minP} – ₹${maxP}` : (minP ? `₹${minP}` : "TBA"),
            lotSize: item.lotSize || content?.lotSize ? String(item.lotSize || content.lotSize) : null,
            status: status,
            schedule: {
                startDate: item.openDate || content?.schedule?.openDate || null,
                endDate: item.closeDate || content?.schedule?.closeDate || null,
                listingDate: item.listingDate || content?.schedule?.listingDate || null,
                upiMandateDeadline: item.mandateEndDate || null,
                allotmentFinalization: item.allotmentDate || content?.schedule?.allotmentDate || null,
                refundInitiation: item.refundDate || content?.schedule?.refundDate || null,
                shareCredit: item.creditToDematDate || null,
                mandateEndDate: item.mandateEndDate || null,
                lockInEndDateAnchor50: item.anchorLockIn50 || null,
                lockInEndDateAnchorRemaining: item.anchorLockInRemaining || null
            },
            issueSize: {
                totalIssueSize: item.issueSize ? String(item.issueSize).replace(/cr/i, "").trim() + " Cr" : null,
                freshIssue: item.freshIssueSize ? String(item.freshIssueSize).replace(/cr/i, "").trim() + " Cr" : null,
                offerForSale: item.ofsIssueSize ? String(item.ofsIssueSize).replace(/cr/i, "").trim() + " Cr" : null
            },
            aboutCompany: content?.description || item.description || null,
            drhpLink: content?.drhpUrl || item.drhpUrl || null,
            rhpLink: content?.rhpUrl || content?.prospectusUrl || item.rhpUrl || null,
            strengths: content?.strengths || content?.pros || [],
            risks: content?.risks || content?.cons || [],
            greyMarketPremium: {
                gmpSource: gmpMatch?.url || IPOWATCH_URL,
                gmpTrends: gmpMatch ? [{ date: "Today", gmp: `₹${gmpMatch.value}`, gain: gmpMatch.gain ? `${gmpMatch.gain}%` : null }] : []
            },
            subscriptionNumbers: {
                institutional: { reserved: null, applied: null, subscription: null },
                nii: { reserved: null, applied: null, subscription: null },
                retail: { reserved: null, applied: null, subscription: null },
                total: { reserved: null, applied: null, subscription: item.totalSubscription ? `${item.totalSubscription}x` : null }
            },
            exchanges: item.exchanges || "BSE, NSE"
        });
    }

    // Sort order
    const rank = { LIVE: 1, UPCOMING: 2, CLOSED: 3, LISTED: 4 };
    finalRecords.sort((a, b) => (rank[a.status] || 9) - (rank[b.status] || 9));

    const payload = {
        status: "success",
        statusCode: 200,
        message: "IPO details fetched successfully",
        count: finalRecords.length,
        data: finalRecords,
        meta: { lastSyncedAt: new Date().toISOString(), version: "5.0.0-final-azure" }
    };

    fs.writeFileSync('ipo-data.json', JSON.stringify(payload, null, 2));
    console.log(`\n✅ SUCCESS! Saved ${finalRecords.length} fully enriched records.`);
}

function parseIpoWatchHtml(html) {
    const records = [];
    const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
        const cells = (row.match(/<(?:td|th)\b[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || []).map(c => c.replace(/<[^>]+>/g, "").trim());
        if (cells.length >= 3) {
            const name = cells[0].replace(/\s+IPO$/i, "").trim();
            const gmp = cells[1].replace(/,/g, "").match(/-?\d+/);
            const gain = cells[2]?.match(/-?\d+(?:\.\d+)?%/);
            if (name && gmp) records.push({ name: name, value: Number(gmp[0]), gain: gain ? gain[0].replace("%", "") : null, url: IPOWATCH_URL });
        }
    }
    return records;
}

function matchGmp(name, list) {
    if (!name || !list.length) return null;
    const target = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const item of list) {
        const cand = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (target === cand || target.includes(cand) || cand.includes(target)) return item;
    }
    return null;
}

runScraper();
