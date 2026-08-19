async function fetchMarketsEasyBackup() {
    console.log("⚠️ PRIMARY ENGINE FAILED. Initiating Marketseasy.in Backup Protocol...");
    
    try {
        const json = await fetchDirect("https://marketseasy.in/api/ipo", true);
        let items = [];
        
        // Safely extract the array regardless of how they format their JSON
        if (Array.isArray(json)) items = json;
        else if (json && Array.isArray(json.data)) items = json.data;
        else if (json && Array.isArray(json.ipos)) items = json.ipos;

        if (items.length === 0) throw new Error("Backup API returned empty data.");

        console.log(`✅ Backup Engine successfully fetched ${items.length} records.`);

        // Map their unpredictable keys to your exact PocketMint Schema
        return items.map(item => ({
            symbol: item.symbol || null,
            type: /SME/i.test(item.type || item.name) ? "SME" : "Mainboard",
            name: item.name || item.companyName || "Unknown IPO",
            detailsUrl: null, // They might not provide your Groww/Upstox links
            logoUrl: item.logo || null,
            priceRange: item.priceRange || item.price || "TBA",
            lotSize: item.lotSize ? String(item.lotSize) : null,
            status: item.status ? item.status.toUpperCase() : "UPCOMING",
            schedule: {
                startDate: item.openDate || item.startDate || null,
                endDate: item.closeDate || item.endDate || null,
                listingDate: item.listingDate || null,
                upiMandateDeadline: null,
                allotmentFinalization: item.allotmentDate || null,
                refundInitiation: item.refundDate || null,
                shareCredit: null,
                mandateEndDate: null,
                lockInEndDateAnchor50: null,
                lockInEndDateAnchorRemaining: null
            },
            issueSize: {
                totalIssueSize: item.issueSize ? String(item.issueSize) : null,
                freshIssue: null,
                offerForSale: null
            },
            aboutCompany: item.description || item.about || null,
            drhpLink: item.drhp || null,
            rhpLink: item.rhp || null,
            strengths: [],
            risks: [],
            greyMarketPremium: {
                gmpSource: "https://marketseasy.in",
                gmpTrends: item.gmp ? [{ date: "Today", gmp: `₹${item.gmp}`, gain: null }] : []
            },
            subscriptionNumbers: {
                institutional: { reserved: null, applied: null, subscription: null },
                nii: { reserved: null, applied: null, subscription: null },
                retail: { reserved: null, applied: null, subscription: null },
                total: { reserved: null, applied: null, subscription: item.subscription || null }
            },
            exchanges: item.exchange || "BSE, NSE"
        }));

    } catch (error) {
        console.error("❌ BACKUP ENGINE ALSO FAILED:", error.message);
        return []; // Return empty if both fail
    }
}
