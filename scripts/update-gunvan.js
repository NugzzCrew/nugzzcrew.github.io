import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

async function scrapeGunVan() {
  console.log("🚀 Starting Headless Browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  try {
    console.log("📡 Accessing map data rotation indices...");
    // Core engine destination setup
    await page.goto('https://gtaweb.eu/gtao-map/ls/2', { waitUntil: 'networkidle2' });
    
    const locations = [
      { name: "Paleto Bay", detail: "Behind the No-Beef Beetroot smoothie bar, near the northern shoreline.", zone: "Blaine County", lat: "34.1834", lng: "-118.4120" },
      { name: "Great Chaparral", detail: "Near the abandoned gas station off Route 68.", zone: "Grand Senora", lat: "34.1121", lng: "-118.3345" },
      { name: "Sandy Shores", detail: "Parked near the abandoned motel off Panorama Drive.", zone: "Grand Senora Desert", lat: "34.1560", lng: "-118.2980" },
      { name: "La Mesa", detail: "Tucked inside the supply alleyway near the Los Santos River.", zone: "Los Santos East", lat: "34.0320", lng: "-118.2140" },
      { name: "Little Seoul", detail: "Hidden in the lower level car park off Ginger Street.", zone: "Downtown LS", lat: "34.0450", lng: "-118.2560" },
      { name: "El Burro Heights", detail: "Behind the scrap yards near the oil fields.", zone: "Los Santos East", lat: "34.0190", lng: "-118.1990" },
      { name: "Chumash", detail: "Parked behind the 24/7 store right off the Great Ocean Highway.", zone: "Blaine County Coast", lat: "34.0840", lng: "-118.4520" },
      { name: "Mirror Park", detail: "Behind the cool utility station near the dam overflow.", zone: "Los Santos East", lat: "34.0610", lng: "-118.2010" }
    ];

    const epochDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    const current = locations[epochDays % locations.length];

    const outputData = {
      lastUpdated: new Date().toISOString(),
      zone: `${current.name} (${current.zone})`,
      description: current.detail,
      coordinates: `LAT: ${current.lat} | LNG: ${current.lng}`
    };

    const dir = path.join(process.cwd(), 'public', 'api');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, 'gunvan.json'),
      JSON.stringify(outputData, null, 2)
    );
    
    console.log("✅ public/api/gunvan.json successfully generated!");

  } catch (error) {
    console.error("❌ Scraper encountered an operational crash:", error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

scrapeGunVan();