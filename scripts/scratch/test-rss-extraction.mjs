import xml2js from 'xml2js';
const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

function stripHTML(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
}

const KNOWN_CONSULTANTS = /(?:AtkinsR\u00e9alis|Atkins|AECOM|Aecom|Worley|Parsons|Jacobs|Mott\s+MacDonald|Foster\s*\+?\s*Partners|Zaha\s+Hadid|HOK|Gensler|Aedas|Dewan|Dar\s+(?:Al-)?Handasah|Projacs|Hill\s+International|Mace|Turner|CBRE|JLL|DAR|Khatib|Saudi\s+Consult|Saudi\s+Engineers|Archirodon|Sinclair|Knight\s+Merz)/i;

const KNOWN_CONTRACTORS = /(?:Samsung\s+C&T|Hyundai\s+E&C|Daewoo|Larsen\s*&?\s*Toubro|Bechtel|Fluor|KBR|Petrofac|Saipem|Technip|McDermott|China\s+Harbour|China\s+Railway|China\s+State|Power\s+China|Sinopec|CCC|Consolidated\s+Contractors|Al-Futtaim\s+Contracting|ALEC|Nesma|نسما|Albawani|البواني|Kafah|كفاح|Al-Arabi|Al-Othman|Al-Muhaidib|Al-Rashid|Al-Zamil|Al-Saad|Al-Qahtani|Al-Khorayef|AlBabtain|Saudi\s+Arabian\s+Aminit|SAAC|Al-Ayuni|Al-Habib|Al-Hokair|Al-Jeraisy|Al-Rugai|Al-Salam|Al-Suwaiket|Shibh\s+Al-Jazira|شبه\s+الجزيرة)/i;

const KNOWN_DEVELOPERS = /(?:Roshn|NEOM|Emaar|Aldar|Damac|Sobha|Nakheel|Meraas|Wasl|Al-Futtaim\s+Real\s+Estate|Al-Hokair\s+Real\s+Estate|Jabal\s+Omar|إعمار|Saudi\s+Real\s+Estate|SRECO|Alinma\s+Real\s+Estate|Kingdom\s+Holdings|KEC|SEDCO|Al-Balad|Al-Sharif|ALARAB|Al-Aqeeq|Al-Dabbagh|Al-Faisal|Al-Ghunaim|Al-Mutlaq|Al-Oula|Al-Rajhi\s+Real|Al-Rugaib|Al-Saghyir|Al-Saedan|Al-Tamimi|Al-Tayyar|Al-Watania|Aseer|Aujan|Bahri|Dallah|Dur\s+Hospitality|Fitaihi|Jarir|MIS|Nadec|Olayan|Seera|Savola|Sipco|Tihama|Al-Muhaidib|Pan\s+Kingdom)/i;

function classifyRole(title, company) {
  // Determine if the company in context of title is owner, contractor, or consultant
  const t = title;
  // Check if company is known type
  if (KNOWN_CONSULTANTS.test(company) || KNOWN_CONSULTANTS.test(t)) return 'consultant';
  if (KNOWN_CONTRACTORS.test(company) || KNOWN_CONTRACTORS.test(t)) return 'contractor';
  if (KNOWN_DEVELOPERS.test(company) || KNOWN_DEVELOPERS.test(t)) return 'owner';
  return null;
}

async function test() {
  let total = 0, ownerOk = 0, contractorOk = 0, consultantOk = 0, valueOk = 0, locationOk = 0, saudiOnly = 0;

  for (let page = 1; page <= 5; page++) {
    const url = page === 1 ? 'https://saudigulfprojects.com/feed/' : `https://saudigulfprojects.com/feed/?paged=${page}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml = await r.text();
    const parsed = await parser.parseStringPromise(xml);
    const items = Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : [parsed.rss.channel.item];

    for (const item of items) {
      const title = item.title;
      const content = await stripHTML(item['content:encoded'] || '');
      const fullText = title + ' ' + content;
      total++;

      const isSaudi = /Saudi\s+Arabia|الرياض|Jeddah|Riyadh|Makkah|Madinah|Dammam|الدمام|King\s+Salman|King\s+Abdullah|NEOM|Roshn|Red\s+Sea|Diriyah|Qiddiya|Aramco|ACWA/gi.test(fullText);
      if (isSaudi) saudiOnly++;

      // ---- VALUE ----
      const valM = fullText.match(/((?:SAR|SR|USD|US\s?\$)\s*[\d,.]+\s*(?:billion|million|bn|mn|B|M|trillion))/i)
        || fullText.match(/([\d,.]+\s*(?:billion|million|bn|mn|B|M))\s*(?:SAR|USD|\$)/i);
      const value = valM?.[0] || null;
      if (value) valueOk++;

      // ---- LOCATION ----
      const cities = ['Riyadh', 'Jeddah', 'Makkah', 'Madinah', 'Medina', 'Dammam', 'Tabuk', 'Abha', 'Hail', 'Najran', 'Jazan', 'Taif', 'Yanbu', 'Jubail', 'Buraidah', 'Khobar', 'Dhahran', 'Al-Ahsa'];
      const cityRegex = new RegExp(`\\b(${cities.join('|')})\\b`, 'i');
      const locM = fullText.match(cityRegex) || fullText.match(/\bin\s+(Riyadh|Jeddah|Makkah|Madinah|Dammam|Tabuk|Abha|Hail|Najran|Jazan|Taif|Yanbu|Jubail|Al-Ahsa)\b/i);
      const location = locM?.[1] || null;
      if (location) locationOk++;

      // ---- EXTRACT ENTITY NAMES FROM TITLE ----
      // Find company-like names in title
      const titleCompanies = [];
      const companyPattern = /([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+(?:and|&\s+)?\s*([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60})?\s+(?:Awarded|Wins|Launches|Signs|Secures|Plans|Appoints|Receives|Gets|Completes|Inaugurates|Breaks|Unveils)/gi;
      let cm;
      while ((cm = companyPattern.exec(title)) !== null) {
        if (cm[1] && cm[1].length > 3) titleCompanies.push(cm[1].trim());
        if (cm[2] && cm[2].length > 3) titleCompanies.push(cm[2].trim());
      }

      // ---- CLASSIFY ----
      let owner = null, contractor = null, consultant = null;

      // Try to find "appointed X" pattern -> X is consultant/contractor
      const appointedM = fullText.match(/([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+has\s+appointed\s+([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+(?:to\s+|as\s+)/i);
      if (appointedM) {
        owner = appointedM[1].trim();
        const appointed = appointedM[2].trim();
        const role = classifyRole(title, appointed) || 'contractor';
        if (role === 'consultant') consultant = appointed;
        else contractor = appointed;
      }

      // "X has been awarded" -> X is contractor
      if (!contractor) {
        const awardedM = fullText.match(/([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+has\s+been\s+(?:awarded|selected|appointed)\s+(?:a|the)?\s*(?:contract|agreement|deal|project|role)/i);
        if (awardedM) contractor = awardedM[1].trim();
      }

      // "X awarded Y contract" -> X is contractor (if X is a company)
      if (!contractor) {
        const awarderM = fullText.match(/([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+(?:Awarded|Secured|Won|Signs?)\s+(?:a|the)?\s*(?:contract|agreement|deal|project)/i);
        if (awarderM) contractor = awarderM[1].trim();
      }

      // Title: "X Launches Y" -> X is owner
      if (!owner) {
        const launchM = fullText.match(/^([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+(?:Launches?|Announces|Plans?|Completes|Inaugurates)/);
        if (launchM) owner = launchM[1].trim();
      }

      // "developed by X" -> X is owner
      if (!owner) {
        const devByM = fullText.match(/(?:developed|being\s+developed|owned)\s+by\s+([A-Z][A-Za-z\s&.,'-]{5,60})/i);
        if (devByM) owner = devByM[1].trim();
      }

      // "for X" at end -> might indicate owner
      // "X developed by Y" -> Y is developer (owner)

      // Use known directories for classification
      if (owner && contractor && owner === contractor) {
        const role = classifyRole(title, owner);
        if (role === 'contractor') contractor = owner;
        else if (role === 'owner') owner = owner;
        else {
          // Default: if title says "Awarded", it's contractor; if "Launch", it's owner
          if (/Awarded|Secured|Won|Signs/i.test(title)) contractor = owner, owner = null;
          else owner = owner, contractor = null;
        }
      }

      // Consultant from "appointed X as" or "X to provide" patterns
      if (!consultant) {
        const consM = fullText.match(/(?:appointed|selected)\s+([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+(?:to\s+provide|as\s+(?:the\s+)?consultant|as\s+(?:the\s+)?engineering)/i);
        if (consM) consultant = consM[1].trim();
      }

      // Title: "X Wins ... Role" -> X is consultant
      if (!consultant) {
        const roleM = title.match(/^([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+(?:Wins|Secures|Gets)\s+(?:a|the)?\s*.+?(?:Role|Design|Consultancy|Planning)\s+(?:for|from)\s+/);
        if (roleM) consultant = roleM[1].trim();
      }

      // Clean up: if owner === contractor, keep one based on role
      if (owner && contractor && owner === contractor) {
        const tLower = title.toLowerCase();
        if (tLower.includes('launch') || tLower.includes('announce') || tLower.includes('plan')) contractor = null;
        else owner = null;
      }

      if (titleCompanies.length > 0 && !owner && !contractor && !consultant) {
        const first = titleCompanies[0];
        const tLower = title.toLowerCase();
        if (tLower.includes('launch') || tLower.includes('announce') || tLower.includes('plan') || tLower.includes('unveil') || tLower.includes('break')) owner = first;
        else if (tLower.includes('award') || tLower.includes('win') || tLower.includes('secure') || tLower.includes('sign')) contractor = first;
      }

      if (owner) ownerOk++;
      if (contractor) contractorOk++;
      if (consultant) consultantOk++;

      if (isSaudi) {
        console.log(`${owner ? 'O' : '\u00b7'}${contractor ? 'C' : '\u00b7'}${consultant ? 'S' : '\u00b7'}${value ? 'V' : '\u00b7'}${location ? 'L' : '\u00b7'} | ${title.slice(0, 65)}`);
        if (owner) console.log(`   Owner: ${owner.slice(0, 60)}`);
        if (contractor) console.log(`   Contractor: ${contractor.slice(0, 60)}`);
        if (consultant) console.log(`   Consultant: ${consultant.slice(0, 60)}`);
      }
    }
  }
  console.log(`\n=== Stats (${total} articles, ${saudiOnly} Saudi) ===`);
  console.log(`Owner: ${ownerOk}, Contractor: ${contractorOk}, Consultant: ${consultantOk}, Value: ${valueOk}, Location: ${locationOk}`);
}
test().catch(console.error);
