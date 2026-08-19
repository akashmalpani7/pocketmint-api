const fs = require('fs');

const UPSTOX_API = "https://service.upstox.com/nextgen-ipo/open/v1";
const UPSTOX_CONTENT = "https://service.upstox.com/content/open/v2";
const IPOWATCH_URL = "https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/";

const delay = ms => new Promise(res => setTimeout(res, ms));

// Stealth Fetcher with 3 Rotating Proxies to prevent any blocks
async function stealthFetchJson(targetUrl) {
    const proxies = [
        targetUrl, // Try direct first
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(targetUrl)}`
    ];

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'application/json',
        'Origin': 'https://upstox.com',
        'Referer': 'https://upstox.com/'
    };

    for (let url of proxies) {
        try {
            let res = await fetch(url, { headers });
            if (res.ok) {
                let text = await res.text();
                if (text.startsWith('<')) continue; // Skip if proxy returns HTML error page
                return JSON.parse(text);
            }
        } catch (e) { }
    }
    return null;
}

async function stealthFetchHtml(targetUrl) {
    const proxies = [
        targetUrl,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(targetUrl)}`
    ];
    for (let url of proxies) {
        try {
            let res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.ok) return await res.text();
        } catch (e) {}
    }
    return "";
}

async function runScraper() {
    console.log("Starting Enterprise Stealth Scraper Engine...");
    const statuses = ["open", "upcoming", "closed", "listed"];
    let rawList = [];

    // 1. Fetch Upstox Discovery
    for (const status of statuses) {
        console.log(`Discovering [${status.toUpperCase()}] IPOs...`);
        const json = await stealthFetchJson(`${UPSTOX_API}/ipos?status=${status}`);
        
        let items = [];
        // Crash-proof check: Handle both Arrays and Paginated Objects safely
        if (json) {
            if (Array.isArray(json.data)) items = json.data;
            else if (json.data && Array.isArray(json.data.list)) items = json.data.list;
            else if (json.data && Array.isArray(json.data.content)) items = json.data.content;
            else if (Array.isArray(json)) items = json;
        }

        if (items.length > 0) {
            rawList.push(...items.map(i => ({ ...i, _lifecycle: status.toUpperCase() })));
            console.log(`-> Successfully found ${items.length} records for ${status}`);
        } else {
            console.log(`-> No records found or structure changed for ${status}`);
        }
        await delay(500); // Polite delay
    }

    if (rawList.length === 0) {
        console.error("CRITICAL ERROR: No records fetched. Proxies may be completely blocked.");
        return;
    }

    // Deduplicate
    const uniqueMap = new Map();
    rawList.forEach(item => {
        if (item.slug && !uniqueMap.has(item.slug)) uniqueMap.set(item.slug, item);
    });
    const uniqueList = Array.from(uniqueMap.values());
    console.log(`\nDiscovered ${uniqueList.length} unique IPOs across all statuses.`);

    // 2. Fetch IPOWatch GMP
    console.log("Fetching GMP sentiment from IPOWatch...");
    let gmpIndex = [];
    const html = await stealthFetchHtml(IPOWATCH_URL);
    if (html) {
        gmpIndex = parseIpoWatchHtml(html);
        console.log(`-> Found ${gmpIndex.length} GMP records`);
    }

    // 3. Process and Merge Deep Details
    const finalRecords = [];
    let count = 0;

    for (const item of uniqueList) {
        count++;
        let content = null;
        const status = item._lifecycle === "OPEN" ? "LIVE" : item._lifecycle;

        // Only fetch deep DRHP/Pros/Cons for LIVE & UPCOMING to prevent hitting limits
        if (status === "LIVE" || status === "UPCOMING") {
            console.log(`[${count}/${uniqueList.length}] Fetching deep data for: ${item.slug}`);
            const cJson = await stealthFetchJson(`${UPSTOX_CONTENT}/ipo/slug/${item.slug}`);
            if (cJson && cJson.data) content = cJson.data;
            await delay(400); 
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
                totalIssueSize: item.issueSize ? String(item.issueSize) + " Cr" : null,
                freshIssue: item.freshIssueSize ? String(item.freshIssueSize) + " Cr" : null,
                offerForSale: item.ofsIssueSize ? String(item.ofsIssueSize) + " Cr" : null
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

    const rank = { LIVE: 1, UPCOMING: 2, CLOSED: 3, LISTED: 4 };
    finalRecords.sort((a, b) => (rank[a.status] || 9) - (rank[b.status] || 9));

    const payload = {
        status: "success",
        statusCode: 200,
        message: "IPO details fetched successfully",
        count: finalRecords.length,
        data: finalRecords,
        meta: { lastSyncedAt: new Date().toISOString(), version: "4.0.0-crashproof" }
    };

    fs.writeFileSync('ipo-data.json', JSON.stringify(payload, null, 2));
    console.log(`\n✅ SUCCESS! Generated ${finalRecords.length} records to ipo-data.json.`);
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
