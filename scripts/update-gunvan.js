import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

// Master Dictionary translating IDs to real locations
const LOCATION_DICT = {
    "1": "No Marks Cleaners, Paleto Bay",
    "2": "Behind the Discount Store, Grapeseed",
    "3": "Merle Abrahams' house, Sandy Shores",
    "4": "Dirt road overlooking Larry's RV Sales, Grand Senora Desert",
    "5": "Vinewood Sign",
    "6": "Behind Ink Inc. Tattoos, Chumash Plaza",
    "7": "Paleto Forest Lumber Yard",
    "8": "Next to Ortega's Trailer, Zancudo River",
    "9": "Palmer-Taylor Power Station",
    "10": "Under the Fort Zancudo Approach Road bridge, Fort Zancudo",
    "11": "Thomson Scrapyard",
    "12": "Car Scrapyard, El Burro Heights",
    "13": "LT Weld Supply Co. / Lester's Warehouse, Murrieta Heights",
    "14": "Walker Ocean Store, Port of Los Santos",
    "15": "Land Act Reservoir (north end)",
    "16": "Fridgit, Forced Labor Place, La Mesa",
    "17": "Terminal (southwest corner)",
    "18": "Rogers Salvage & Scrap, La Puerta",
    "19": "Popular Street, La Mesa",
    "20": "Alleyway carport, Del Perro",
    "21": "Magellan Ave / Conquistador St, Vespucci Beach",
    "22": "Parking above J's Bonds, West Vinewood",
    "23": "Parking garage south of Oriental Theater, Downtown Vinewood",
    "24": "24 hour parking, Pillbox Hill",
    "25": "Caesars Auto Parking, Little Seoul",
    "26": "Abandoned auto service garage, Joshua Road, Alamo Sea",
    "27": "Hookies, North Chumash",
    "28": "Public toilets west of Procopio Truck Stop, Procopio Beach",
    "29": "Hearty Taco, Mirror Park",
    "30": "In an alley next to Bishop's Chicken, Davis"
};

async function launchBrowser() {
    return puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
}

async function getPageText(browser, url, waitMs = 6000, retries = 2) {
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
            await new Promise(r => setTimeout(r, waitMs));
            const text = await page.evaluate(() => document.body.innerText);
            await page.close();
            return text;
        } catch (err) {
            console.warn(`Attempt ${attempt} failed for ${url}: ${err.message}`);
            try { await page.close(); } catch { }
            if (attempt > retries) throw err;
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

function extractFromGTALens(plainText) {
    const lines = plainText.split('\n');
    let rawLocationId = "";

    for (const line of lines) {
        if (line.toLowerCase().includes('[active]') && line.toLowerCase().includes('van')) {
            const idMatch = line.match(/#(\d+)/);
            if (idMatch) {
                rawLocationId = idMatch[1].trim();
                break;
            }
        }
    }

    if (!rawLocationId) {
        const activeMatch = plainText.match(/Gun Van #(\d+)\s*\[active\]/i);
        if (activeMatch) rawLocationId = activeMatch[1].trim();
    }

    if (!rawLocationId) return null;

    // Inventory
    let inventory = [];
    const inventoryMatch = plainText.match(/In stock:([\s\S]*?)(?=Locations|Gun Van #1\s|Watch video|Remove all)/i);
    if (inventoryMatch) {
        inventory = inventoryMatch[1]
            .split('\n')
            .map(i => i.trim())
            .filter(item => {
                if (!item || item.length < 3) return false;
                if (/^(Weapons|Throwables|Body armor):?$/i.test(item)) return false;
                if (item.includes("updated weekly")) return false;
                if (item.includes("Watch video") || item.includes("Remove all") || item.includes("Reveal coordinates")) return false;
                return true;
            })
            .map(item => item.replace(/\s*:\s*/, ": ").replace(/\s+%/g, " %"));
    }

    return { rawLocationId, inventory };
}

function extractFromGTAMap(plainText) {
    const spotMatch = plainText.match(/Spot\s*#(\d+)\s*\(today\)/i) || plainText.match(/spot\s*#(\d+)/i);
    if (!spotMatch) return null;

    const rawLocationId = spotMatch[1].trim();

    // Rough inventory extraction (item names + discount)
    const inventory = [];
    const lines = plainText.split('\n');
    let inStock = false;
    for (const line of lines) {
        if (/this week's stock|weapons|throwables|body armor/i.test(line)) inStock = true;
        if (inStock && /about gun van|quick tips|source:/i.test(line)) break;

        const itemMatch = line.match(/^(.+?)\s*[−-]\s*(\d+)\s*%/);
        if (itemMatch && !/item|sale|list|gta\+/i.test(itemMatch[1])) {
            const name = itemMatch[1].trim();
            const disc = itemMatch[2];
            inventory.push(`${name}: -${disc} %`);
        }
        if (/free|FREE/i.test(line) && /baseball|shocker|bat/i.test(line)) {
            inventory.push(line.trim().replace(/\s+/g, " ") + ": FREE");
        }
    }

    return { rawLocationId, inventory };
}

function extractFromGTABoss(plainText) {
    const spotMatch = plainText.match(/spot\s*(\d+)/i) || plainText.match(/#(\d+)/);
    if (!spotMatch) return null;
    return { rawLocationId: spotMatch[1].trim(), inventory: [] };
}

async function fetchGunVanLocation() {
    console.log("🚀 Launching Headless Browser Engine...");
    const browser = await launchBrowser();

    try {
        let result = null;
        let source = "";

        // 1. Try GTALens (primary)
        try {
            console.log("📡 Navigating to GTALens Map Layer...");
            const text = await getPageText(browser, 'https://gtalens.com/map/gun-vans', 7000, 2);
            console.log("🕵️‍♂️ Extracting from GTALens...");
            result = extractFromGTALens(text);
            if (result) source = "GTALens";
        } catch (e) {
            console.warn("GTALens failed:", e.message);
        }

        // 2. Fallback: gtamap.net
        if (!result) {
            try {
                console.log("📡 Fallback → gtamap.net...");
                const text = await getPageText(browser, 'https://gtamap.net/gta-online/daily/gun-van', 5000, 1);
                console.log("🕵️‍♂️ Extracting from gtamap.net...");
                result = extractFromGTAMap(text);
                if (result) source = "gtamap.net";
            } catch (e) {
                console.warn("gtamap.net failed:", e.message);
            }
        }

        // 3. Last fallback: gtaboss.gg
        if (!result) {
            try {
                console.log("📡 Last fallback → gtaboss.gg...");
                const text = await getPageText(browser, 'https://www.gtaboss.gg/gta-5-online/gun-van', 5000, 1);
                result = extractFromGTABoss(text);
                if (result) source = "gtaboss.gg";
            } catch (e) {
                console.warn("gtaboss.gg failed:", e.message);
            }
        }

        if (!result || !result.rawLocationId || result.rawLocationId === "0") {
            throw new Error("Extraction Fault: Could not isolate the active gun van ID from any source.");
        }

        const rawLocationId = result.rawLocationId;
        let inventory = result.inventory || [];

        if (!LOCATION_DICT[rawLocationId]) {
            throw new Error(`Data Mapping Fault: Extracted ID #${rawLocationId} has no dictionary description entry.`);
        }

        const finalLocationName = LOCATION_DICT[rawLocationId];

        if (inventory.length === 0) {
            inventory = [
                "Combat Shotgun: -10 %",
                "Precision Rifle: -10 %",
                "Railgun: -50 %",
                "Compact Rifle: -10 %",
                "MG: -10 %",
                "Machete: -10 %"
            ];
            console.log("⚠️ Using fallback inventory (source provided none)");
        }

        console.log(`🎯 Location Found: ${finalLocationName} (ID: ${rawLocationId}) via ${source}`);

        if (!fs.existsSync('./public/api')) {
            fs.mkdirSync('./public/api', { recursive: true });
        }

        const data = {
            locationId: parseInt(rawLocationId, 10),
            zone: `Gun Van Location #${rawLocationId}`,
            description: finalLocationName,
            mapPath: `map_${rawLocationId}.jpg`,
            inventory,
            updatedAt: new Date().toISOString(),
            source
        };

        fs.writeFileSync('./public/api/gunvan.json', JSON.stringify(data, null, 2));
        console.log("✅ Successfully saved synchronized data schema to /public/api/gunvan.json");

    } catch (error) {
        console.error("❌ Scraper Error:", error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

fetchGunVanLocation();