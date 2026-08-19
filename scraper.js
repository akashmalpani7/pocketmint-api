const fs = require('fs');

const UPSTOX_API = "https://service.upstox.com/nextgen-ipo/open/v1";
const UPSTOX_CONTENT = "https://service.upstox.com/content/open/v2";
const IPOWATCH_URL = "https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/";

async function runScraper() {
    console.log("Starting Scraper Engine...");
    const statuses = ["open", "upcoming", "closed", "listed"];
    let rawList = [];

    // 1. Fetch Upstox Discovery (Azure IPs bypass Cloudflare blocks)
    for (const status of statuses) {
        try {
            const res = await fetch(`${UPSTOX_API}/ipos?status=${status}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const json = await res.json();
            if (json && json.data) {
                rawList.push(...json.data.map(i => ({ ...i, _lifecycle: status.toUpperCase() })));
            }
        } catch(e) { console.log(`Failed status: ${status}`); }
    }

    // 2. Fetch IPOWatch GMP
    let gmpIndex = [];
    try {
        const res = await fetch(IPOWATCH_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        gmpIndex = parseIpoWatchHtml(html);
    } catch(e) { console.log("Failed GMP fetch"); }

    // 3. Process and Merge Deep Details
    const finalRecords = [];
    for (const item of rawList) {
        let content = null;
        const status = item._lifecycle === "OPEN" ? "LIVE" : item._lifecycle;

        // Fetch deep details (Dates, DRHP) for Active IPOs
        if (status === "LIVE" || status === "UPCOMING") {
            try {
                const cRes = await fetch(`${UPSTOX_CONTENT}/ipo/slug/${item.slug}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const cJson = await cRes.json();
                if (cJson && cJson.data) content = cJson.data;
            } catch(e) {}
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

    // Sort order
    const rank = { LIVE: 1, UPCOMING: 2, CLOSED: 3, LISTED: 4 };
    finalRecords.sort((a, b) => (rank[a.status] || 9) - (rank[b.status] || 9));

    const payload = {
        status: "success",
        statusCode: 200,
        message: "IPO details fetched successfully",
        count: finalRecords.length,
        data: finalRecords,
        meta: { lastSyncedAt: new Date().toISOString(), version: "1.0.0-github-engine" }
    };

    // Save data to a file
    fs.writeFileSync('ipo-data.json', JSON.stringify(payload, null, 2));
    console.log(`Successfully saved ${finalRecords.length} records.`);
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
