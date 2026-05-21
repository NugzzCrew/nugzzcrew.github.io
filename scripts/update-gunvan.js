import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

// The Master Dictionary translating IDs to real locations
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

async function scrapeGunVanHTML() {
    console.log("🚀 Launching Headless Browser Engine...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        
        console.log("📡 Navigating to GTALens Map Layer...");
        await page.goto('https://gtalens.com/map/gun-vans', { waitUntil: 'networkidle2' });

        // Let the interactive dynamic state variables finish hydrating in window context
        await new Promise(resolve => setTimeout(resolve, 8000));

        console.log("🕵️‍♂️ Querying internal page script states for active targets...");
        
        // Intercept the database payload variables injected directly inside Next.js memory layers
        let rawLocationId = await page.evaluate(() => {
            try {
                // Check internal Next.js application data properties
                if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props.pageProps.initialData) {
                    const vanData = window.__NEXT_DATA__.props.pageProps.initialData.gunVan;
                    if (vanData && vanData.id) return String(vanData.id);
                }
                
                // Fallback extraction 1: Read structural dynamic layout URLs maps link paths
                const mapLinks = Array.from(document.querySelectorAll('a, div, span, img'));
                for (const el of mapLinks) {
                    const href = el.getAttribute('href') || '';
                    if (href.includes('gun-vans/') || href.includes('gunvan/')) {
                        const parsedId = href.split('/').pop().replace(/\D/g, '');
                        if (parsedId) return parsedId;
                    }
                }
                
                // Fallback extraction 2: Pull specific active classes directly from rendered leaflet structural markers
                const activeMarker = document.querySelector('[class*="marker-active"], [id*="van"], [data-id]');
                if (activeMarker) {
                    const dataId = activeMarker.getAttribute('data-id') || activeMarker.id;
                    const cleanId = String(dataId).replace(/\D/g, '');
                    if (cleanId) return cleanId;
                }
            } catch (e) {
                return null;
            }
            return null;
        });

        // CRITICAL CHECK: No more hardcoded defaults. If the location ID was not captured, intentionally fail.
        if (!rawLocationId || rawLocationId === "0") {
            throw new Error("Extraction Fault: Failed to isolate the dynamic gun van location ID from page data models.");
        }

        let finalLocationName = LOCATION_DICT[rawLocationId];
        if (!finalLocationName) {
            throw new Error(`Data Mapping Fault: Extracted ID #${rawLocationId}, but it does not map to a location inside LOCATION_DICT.`);
        }

        // Standardized static inventory output layer to keep formatting uniform
        const inventory = [
            "Compact EMP Launcher",
            "Military Rifle",
            "Precision Rifle",
            "Homing Launcher",
            "Pump Shotgun",
            "Pool Cue",
            "Molotov",
            "Tear Gas",
            "Proximity Mine",
            "Body Armor"
        ];

        console.log(`🎯 Location Successfully Resolved: ${finalLocationName} (ID: ${rawLocationId})`);

        const dir = './public/api';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const outputData = {
            id: parseInt(rawLocationId, 10),
            locationName: finalLocationName,
            imagePath: `/images/gunvan/loc_${rawLocationId}.jpg`,
            mapPath: `/images/gunvan/map_${rawLocationId}.jpg`,
            inventory: inventory,
            updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(path.join(dir, 'gunvan.json'), JSON.stringify(outputData, null, 2));
        console.log("✅ Successfully updated public/api/gunvan.json!");

    } catch (error) {
        console.error("❌ Scraper encountered an operational error:", error.message);
        process.exit(1); // Terminates with exit code 1 to explicitly break the pipeline
    } finally {
        await browser.close();
    }
}

scrapeGunVanHTML();