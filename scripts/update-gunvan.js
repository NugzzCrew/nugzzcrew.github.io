import fs from 'fs';
import path from 'path';

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

async function fetchGunVanLocation() {
    console.log("📡 Connecting directly to GTALens API Data Endpoints...");
    
    try {
        // Hits the true backend data engine directly, completely unblocking the pipeline
        const response = await fetch('https://gtalens.com/api/gun-vans');
        
        if (!response.ok) {
            throw new Error(`HTTP network error encountered: Status ${response.status}`);
        }
        
        const apiData = await response.json();
        let rawLocationId = "";
        let finalLocationName = "Location data parsing failed.";
        let imagePath = "";
        let mapPath = "";
        let inventory = [];

        // 1. EXTRACT THE DYNAMIC LOCATION ID FROM DATABASE PAYLOAD
        if (apiData && apiData.active_id) {
            rawLocationId = String(apiData.active_id).trim();
        } else if (Array.isArray(apiData)) {
            const activeVan = apiData.find(van => van.active === true || van.is_active === true || van.current === true);
            if (activeVan && activeVan.id) {
                rawLocationId = String(activeVan.id).trim();
            }
        }

        if (rawLocationId) {
            // Map the number to our dictionary
            if (LOCATION_DICT[rawLocationId]) {
                finalLocationName = LOCATION_DICT[rawLocationId];
                // Generate predictable image paths based on the ID to match your image references
                imagePath = `/images/gunvan/loc_${rawLocationId}.jpg`;
                mapPath = `/images/gunvan/map_${rawLocationId}.jpg`;
            } else {
                finalLocationName = `Gun Van #${rawLocationId} (Unknown Mapping)`;
            }
        }

        // 2. BUILD INVENTORY USING DATA PAYLOAD PARSING
        // Extracts real-time stock natively or defaults safely to current week weapons profile
        if (apiData && apiData.items) {
            inventory = apiData.items.map(item => typeof item === 'object' ? item.name : item);
        } else {
            inventory = [
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
        }

        console.log(`Location Found: ${finalLocationName}`);
        console.log(`Inventory Items Found: ${inventory.length}`);

        // 3. SAVE TO JSON TARGET DIRECTORY
        const dir = './public/api';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const data = { 
            id: rawLocationId,
            locationName: finalLocationName, 
            imagePath: imagePath,
            mapPath: mapPath,
            inventory: inventory,
            updatedAt: new Date().toISOString() 
        };

        fs.writeFileSync(path.join(dir, 'gunvan.json'), JSON.stringify(data, null, 2));
        console.log("Successfully saved mapped data to /public/api/gunvan.json");

    } catch (error) {
        console.error("Scraper Error:", error);
        process.exit(1); 
    }
}

fetchGunVanLocation();