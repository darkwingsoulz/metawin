/*
  MetaWin Dashboard created by dwsoulz
*/
require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const TOKEN_BEARER = process.env.TOKEN_BEARER;
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10);
const BATCH_SIZE = 25;
const RETRIES = 10;

const METAWIN_ENDPOINTS = {
  NOTIFICATIONS: 'https://api.prod.platform.metawin.com/notification',
  CLAIMS: 'https://api.prod.platform.metawin.com/inventory',
  REWARDS: 'https://api.prod.platform.metawin.com/reward',
  //HILO: 'https://api.prod.platform.mwapp.io/game/history/hilo', DOES NOT WORK RIGHT NOW
  //REKT: 'https://api.prod.platform.mwapp.io/game/history/crash' DOES NOT WORK RIGHT NOW
};

const REKT_IMAGE_URL = "https://content.prod.platform.mwapp.io/games/NEWREKT.png";
const HILO_IMAGE_URL = "https://content.prod.platform.mwapp.io/games/NEWHILO.png";

const headers = {
  'Origin': 'https://metawin.com',
  'Authorization': 'Bearer ' + TOKEN_BEARER
};

const now = new Date();
const sevenDaysAgo = new Date(now);
sevenDaysAgo.setDate(now.getDate() - 7);

//used for month arrays
const getMonthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

let ethRates = {};
let rewardsByMonth = [];
let reportOverallStatsByGameType = [];
let reportDailyStats = [];
let reportSessionStats = [];
let reportProviderStats = [];
let reportMonthlyStats = [];
let reportGameData = [];
let forex = loadRates();

async function fetchEthRates() {
  // Fetch the last 3 years' data (CryptoCompare's limit is 2000 days per request, so 1095 is fine)
  const response = await fetch('https://min-api.cryptocompare.com/data/v2/histoday?fsym=ETH&tsym=USD&limit=1095');
  const data = await response.json();

  if (!data.Data || !data.Data.Data) {
    console.error("Failed to retrieve data.");
    return {};
  }

  const ethRates = {};

  // Process each day's data
  data.Data.Data.forEach((dayData) => {
    const justTheDate = new Date(dayData.time * 1000).toISOString().split('T')[0];
    ethRates[justTheDate] = dayData.close;
  });

  return ethRates;
}

function convertEthToUSD(amountInEth, createTime) {
  // Extract just the date part (YYYY-MM-DD) from createTime
  const dateKey = new Date(createTime).toISOString().split('T')[0];

  // Lookup the ETH-to-USD rate for that date
  const ethRate = ethRates[dateKey];

  // If the rate is undefined, handle it (e.g., rate not found for the date)
  if (ethRate === undefined) {
    console.log(`ETH rate not found for date: ${dateKey}`);
    return 0;
  }

  // Convert the ETH amount to USD
  const amountInUSD = amountInEth * ethRate;
  return amountInUSD;
}

async function fetchData(apiUrl, page, retries = 10, delayMs = 1000) {
  try {
    const response = await axios.get(`${apiUrl}?page=${page}&pageSize=${PAGE_SIZE}`, { headers });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Request failed, retrying in ${delayMs} ms... (${10 - retries + 1}/10)`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return fetchData(apiUrl, page, retries - 1, delayMs);
    } else {
      console.error('All retries failed.');
      return null;
    }
  }
}

function getValue(urlType) {
  const latestIdFile = path.join(__dirname, 'data', 'latest_id.json');

  if (fs.existsSync(latestIdFile)) {
    const data = JSON.parse(fs.readFileSync(latestIdFile, 'utf8'));

    return data[urlType] || 0;
  }

  return 0;
}

function saveValue(urlType, newestId) {
  const latestIdFile = path.join(__dirname, 'data', 'latest_id.json');

  let data = {};

  if (fs.existsSync(latestIdFile)) {
    data = JSON.parse(fs.readFileSync(latestIdFile, 'utf8'));
  }

  data[urlType] = newestId;

  // Write the updated data back to the file
  fs.writeFileSync(latestIdFile, JSON.stringify(data, null, 2));
}

async function saveData(urlType, data, page, dataDate) {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  const filePath = path.join(
    dir,
    dataDate ? `${urlType}_${dataDate}_${page}.json` : `${urlType}_${page}.json`
  );

  if (data && data.totalCount > 0)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function formatDate(date) {
  return date.toISOString().split('.')[0] + '.000Z';
}

async function fetchDataV2(fromISO, toISO, page, retries = RETRIES, delayMs = 1000) {
  const BASE_URL = 'https://api.prod.platform.mwapp.io/game/action';
  const url = `${BASE_URL}?page=${page}&pageSize=${PAGE_SIZE}&createdFrom=${fromISO}&createdTo=${toISO}`;

  try {
    const response = await axios.get(url, { headers });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Request failed for page ${page}, retrying in ${delayMs} ms... (${RETRIES - retries + 1}/${RETRIES})`);
      await sleep(delayMs);
      return fetchDataV2(fromISO, toISO, page, retries - 1, delayMs);
    } else {
      console.error(`All retries failed for page ${page} from ${fromISO} to ${toISO}`);
      return null;
    }
  }
}

async function fetchDayData(startDate) {
  const createdFrom = new Date(startDate);
  const createdTo = new Date(startDate);
  createdTo.setUTCHours(23, 59, 59, 999);

  const fromISO = formatDate(createdFrom);
  const toISO = formatDate(createdTo);

  console.log(`Fetching data from ${fromISO} to ${toISO}`);

  let page = 1;
  let pageCount = 1;

  while (page <= pageCount) {
    const data = await fetchDataV2(fromISO, toISO, page);

    if (!data) {
      console.warn(`Skipping page ${page} for ${fromISO}`);
      break;
    }

    if (page === 1) {
      pageCount = data.pageCount || 1;
    }

    await saveData("HISTORY", data, page, createdFrom.toISOString().split('T')[0]);
    page++;
    await sleep(300);
  }


}


//delete all pages for latest retrieve day
//import for resuming imports
function deleteLatestHistoryDay() {
  let dir = "data";
  if (!fs.existsSync(dir)) {
    console.warn(`Directory does not exist: ${dir}`);
    return null;
  }

  const files = fs.readdirSync(dir);
  const dateRegex = /^HISTORY_(\d{4}-\d{2}-\d{2})_\d+\.json$/;

  const dates = new Set();

  // Extract valid dates
  for (const file of files) {
    const match = file.match(dateRegex);
    if (match) {
      dates.add(match[1]);
    }
  }

  if (dates.size === 0) return null;

  // Find latest date
  const latestDate = [...dates].sort().pop();

  // Delete all files with that date
  for (const file of files) {
    if (file.startsWith(`HISTORY_${latestDate}_`)) {
      fs.unlinkSync(path.join(dir, file));
    }
  }

  return new Date(`${latestDate}T00:00:00Z`);
}


async function downloadHistory(startDate) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let d = new Date(startDate); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {

    await fetchDayData(new Date(d));

  }
}

function loadRates() {
  const raw = fs.readFileSync(path.resolve("forex.json"), 'utf8');
  return JSON.parse(raw);
}

function getForexRate(month, currency) {
  if (!forex[month]) {
    const months = Object.keys(forex).sort();
    month = months[months.length - 1];
  }

  const monthRates = forex[month];
  return monthRates[currency] ?? 0;  // Return 0 if currency not found
}


async function updateLocalFiles(urlType) {
  const apiUrl = METAWIN_ENDPOINTS[urlType];
  const newestId = getValue(urlType);

  let resumeTotalPages = getValue(`${urlType}_resume_totalpages`);
  let resumePage = getValue(`${urlType}_resume`);
  let totalPages = 0;
  let startingPage = 2;

  try {
    if (resumePage > 0) {
      console.log(`Resuming from page ${resumePage} for ${urlType}...`);
      totalPages = resumeTotalPages;
      startingPage = resumePage;
    }
    else {
      console.log(`Retrieving data for ${urlType}...`);

      const firstPageData = await fetchData(apiUrl, 1);
      if (!firstPageData) {
        console.log(`Error fetching new data for ${urlType}.`);
        return;
      }

      const newItems = firstPageData.items.filter(item => item.id > newestId);

      if (newItems.length > 0) {
        firstPageData.items = newItems;
        await saveData(urlType, firstPageData, 1);
      } else {
        console.log(`${urlType} already up to date.`);
        return;
      }

      console.log(`New data incoming for ${urlType}.`);

      totalPages = firstPageData.pageCount;

      let maxId = Math.max(...newItems.map(item => item.id));
      saveValue(urlType, maxId);
    }

    for (let page = startingPage; page <= totalPages; page++) {
      console.log(`Retrieving data for ${urlType} (${page} of ${totalPages})`);

      const pageData = await fetchData(METAWIN_ENDPOINTS[urlType], page);

      if (pageData) {
        if (resumePage == 0 && newestId && pageData.items.some(item => item.id <= newestId)) {
          const newItems = pageData.items.filter(item => item.id > newestId);
          pageData.items = newItems;
          await saveData(urlType, pageData, page);
          console.log("No additional pages needed and can be skipped!");
          break;
        } else {
          await saveData(urlType, pageData, page);
        }
      }
      else {
        saveValue(`${urlType}_resume`, page);
        saveValue(`${urlType}_resume_totalpages`, totalPages);
        console.log(`Error retrieving data on ${urlType} page ${page}. Will resume on next run. Consider updating your bearer token and/or changing your IP if your requests are getting blocked.`)
        throw new Error();
      }
    }

    saveValue(`${urlType}_resume`, 0);
    saveValue(`${urlType}_resume_totalpages`, 0);
  } catch (error) {
    console.log(`Cannot retrieve new data for ${urlType}, need new token`);
  }
}

async function updateLocalFilesForMiniGames(urlType) {

  const apiUrl = METAWIN_ENDPOINTS[urlType];
  const newestId = getValue(urlType);

  let resumeTotalPages = getValue(`${urlType}_resume_totalpages`);
  let resumePage = getValue(`${urlType}_resume`);
  let totalPages = 0;
  let startingPage = 2;

  try {
    if (resumePage > 0) {
      console.log(`Resuming from page ${resumePage} for ${urlType}...`);
      totalPages = resumeTotalPages;
      startingPage = resumePage;
    }
    else {
      console.log(`Retrieving data for ${urlType}...`);

      const firstPageData = await fetchData(apiUrl, 1);
      if (!firstPageData) {
        console.log(`Error fetching new data for ${urlType}.`);
        return;
      }

      const newItems = firstPageData.items.filter(item => item.createTime > newestId);

      if (newItems.length > 0) {
        firstPageData.items = newItems;
        await saveData(urlType, firstPageData, 1);
      } else {
        console.log(`${urlType} already up to date.`);
        return;
      }

      console.log(`New data incoming for ${urlType}.`);

      totalPages = firstPageData.pageCount;

      let maxId = Math.max(...newItems.map(item => item.createTime));
      saveValue(urlType, maxId);
    }

    for (let page = startingPage; page <= totalPages; page++) {
      console.log(`Retrieving data for ${urlType} (${page} of ${totalPages})`);

      const pageData = await fetchData(METAWIN_ENDPOINTS[urlType], page);

      if (pageData) {
        if (resumePage == 0 && newestId && pageData.items.some(item => item.createTime <= newestId)) {
          const newItems = pageData.items.filter(item => item.createTime > newestId);
          pageData.items = newItems;
          await saveData(urlType, pageData, page);
          console.log("No additional pages needed and can be skipped!");
          break;
        } else {
          await saveData(urlType, pageData, page);
        }
      }
      else {
        saveValue(`${urlType}_resume`, page);
        saveValue(`${urlType}_resume_totalpages`, totalPages);
        console.log(`Error retrieving data on ${urlType} page ${page}. Will resume on next run. Consider updating your bearer token and/or changing your IP if your requests are getting blocked.`)
        throw new Error();
      }
    }

    saveValue(`${urlType}_resume`, 0);
    saveValue(`${urlType}_resume_totalpages`, 0);
  } catch (error) {
    console.log(`Cannot retrieve new data for ${urlType}, need token`);
  }
}

function readAllDataFromLocalFiles() {
  const dir = path.join(__dirname, 'data');
  const historyData = [];
  const otherData = [];

  const untrackedGamesFilePath = path.join(__dirname, 'untracked-games.json');
  if (fs.existsSync(untrackedGamesFilePath)) {
    const untrackedGamesData = JSON.parse(fs.readFileSync(untrackedGamesFilePath, 'utf8'));
    if (untrackedGamesData.items && untrackedGamesData.items.length > 0)
      historyData.push(untrackedGamesData);
  }

  fs.readdirSync(dir).forEach(file => {
    if (file.endsWith('.json') && file !== 'latest_id.json') {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

      //the ordering is important to handle localized eth rates from history files
      //we could also pull from a public api but that would require a key
      if (/REWARDS|CLAIMS|NOTIFICATIONS/.test(file)) {
        otherData.push(data);
      } else {
        historyData.push(data);
      }
    }
  });

  return [...historyData, ...otherData];
}

function getTimeDate(createTime) {
  const dateObj = new Date(createTime);

  // Define the options for the date format, including the time zone
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };

  // Format the date to the desired time zone
  const dateFormatter = new Intl.DateTimeFormat('en-US', options);
  const formattedDate = dateFormatter.format(dateObj);

  // Convert the formatted date into the YYYY-MM-DD format
  const [month, day, year] = formattedDate.split('/');
  const date = `${year}-${month}-${day}`;

  return date;
}


function processData(allData) {
  console.log("Data processing starting.");

  const stats = {};
  const providerStats = {};
  const overallStats = { winsUSD: 0, lossesUSD: 0, lossesUSD7Days: 0, netUSD: 0, rewards: 0, currencies: {}, gameType: {} };
  const dailyNetUSD = {};
  const sessionNetUSD = {};
  const gameInfo = {};
  const totalBatches = Math.ceil(allData.length / BATCH_SIZE);
  const roundTracker = {};

  for (let batch = 0; batch < totalBatches; batch++) {
    let percentComplete = ((batch + 1) / totalBatches) * 100;
    console.log(`Processing stats ${percentComplete.toFixed(2)}% complete`);

    // Slice the data into smaller batches
    const batchData = allData.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);

    // Process each batch individually
    batchData.forEach(data => {
      data.items.forEach(item => {

        //check for HILO/REKT
        if (item.event) {
          if (item.event !== 'player-round-result') return;

          let miniGameName = "";
          let miniGameThumbnail = "";
          let betAmount = "";
          let prizeAmount = "";
          const metawinstudios = "Metawinstudios";

          //HILO
          if (typeof item.data.lifeNumber !== 'undefined') {
            miniGameName = "HILO";
            miniGameThumbnail = HILO_IMAGE_URL;

            //must be USD
            if (!item.data.sourceCurrency || item.data.sourceCurrency !== "USD") return;

            betAmount = item.data.betAmount;
            prizeAmount = item.data.prizeAmount;

          } else {
            miniGameName = "REKT";
            miniGameThumbnail = REKT_IMAGE_URL;

            betAmount = item.data.playerLastRound.betAmount;
            prizeAmount = item.data.playerLastRound.payout;
            if (!prizeAmount) prizeAmount = 0;
          }

          const date = getTimeDate(item.createTime);

          if (!gameInfo[miniGameName]) gameInfo[miniGameName] = { thumbnail: miniGameThumbnail };
          if (!stats[miniGameName]) stats[miniGameName] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0, bestMulti: 0, bestWinUSD: 0 };
          if (!overallStats.gameType[miniGameName]) overallStats.gameType[miniGameName] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };
          if (!dailyNetUSD[date]) dailyNetUSD[date] = { netUSD: 0, plays: 0, betSize: 0 };

          if (!providerStats[metawinstudios]) providerStats[metawinstudios] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };

          let roundMultiplier = (prizeAmount / betAmount);

          if (stats[miniGameName].bestMulti < roundMultiplier)
            stats[miniGameName].bestMulti = roundMultiplier;

          if (stats[miniGameName].bestWinUSD < prizeAmount)
            stats[miniGameName].bestWinUSD = prizeAmount;

          const dateCreateTime = new Date(item.createTime);
          if (dateCreateTime >= sevenDaysAgo && dateCreateTime <= now)
            overallStats.lossesUSD7Days += betAmount;

          let prizeDiff = prizeAmount - betAmount;
          let isProfit = prizeAmount - betAmount > 0;

          stats[miniGameName].netUSD += prizeDiff;
          stats[miniGameName].plays++;
          stats[miniGameName].lossesUSD += betAmount;

          if (isProfit) stats[miniGameName].winsUSD += prizeDiff;
          if (isProfit) stats[miniGameName].payouts++;

          overallStats.netUSD += prizeDiff;
          overallStats.lossesUSD += betAmount;
          overallStats.netUSD += prizeDiff;
          overallStats.gameType[miniGameName].lossesUSD += betAmount;
          overallStats.gameType[miniGameName].netUSD += prizeDiff;
          overallStats.gameType[miniGameName].plays++;

          if (isProfit) overallStats.gameType[miniGameName].winsUSD += prizeDiff;
          if (isProfit) overallStats.gameType[miniGameName].payouts++;
          if (isProfit) overallStats.winsUSD += prizeDiff;

          providerStats[metawinstudios].netUSD -= prizeDiff;
          providerStats[metawinstudios].plays++;
          providerStats[metawinstudios].lossesUSD += betAmount;
          if (isProfit) providerStats[metawinstudios].winsUSD += prizeDiff;
          if (isProfit) providerStats[metawinstudios].payouts++;

          dailyNetUSD[date].netUSD += prizeDiff;
          dailyNetUSD[date].plays++;
          dailyNetUSD[date].betSize += betAmount;

          return;
        }

        //ignore competition entries
        if (item.type === 'SweepstakeEntry') return;

        if (item.type === 'BuyIn' || item.type === 'PayOut') {
          const { game, providerCurrency, createTime } = item;

          let gameName = game.name;

          // Normalize game names
          if (gameName.startsWith("Baccarat") && game.type === "LiveCasino") {
            gameName = "Baccarat";
          } else if (gameName.startsWith("Blackjack") && game.type === "LiveCasino") {
            gameName = "Blackjack";
          } else if (gameName.startsWith("Roulette") && game.type === "LiveCasino") {
            gameName = "Roulette";
          }

          const date = getTimeDate(createTime);

          let rateToUSD = 0;
          let amountInUSD = 0;

          if (providerCurrency.code == "USD" || providerCurrency.code == "USDC" || providerCurrency.code == "USDT") {
            rateToUSD = 1;
            amountInUSD = Number(providerCurrency.amount);
          }
          else if (providerCurrency.code == "ETH") {
            amountInUSD = convertEthToUSD(providerCurrency.amount, item.createTime)
          }
          else if (providerCurrency.code == "SOL") {
            return;
          }
          else {

            let monthKey = date.substring(0, 7);

            rateToUSD = getForexRate(monthKey, providerCurrency.code);

            //currency not found
            if (rateToUSD == 0 && providerCurrency.code != "USD") {
              return;
            }

            amountInUSD = Number(providerCurrency.amount) / rateToUSD;
          }

          let providerAndStudio = formatProviderAndStudio(game.provider, game.studio);

          //provider stats
          if (!providerStats[providerAndStudio]) providerStats[providerAndStudio] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };

          //game stats
          if (!stats[gameName]) stats[gameName] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0, bestMulti: 0, bestWinUSD: 0 };
          if (!gameInfo[gameName]) gameInfo[gameName] = { thumbnail: game.thumbnail };

          //overall stats
          if (!overallStats.gameType[game.type]) {
            overallStats.gameType[game.type] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };
          }

          if (!dailyNetUSD[date]) {
            dailyNetUSD[date] = { netUSD: 0, plays: 0, betSize: 0 };
          }

          if (!sessionNetUSD[item.sessionId]) sessionNetUSD[item.sessionId] = {
            netUSD: 0, plays: 0, betSize: 0,
            date: date,
            dateMin: item.createTime,
            dateMax: item.createTime,
            sessionLength: 0
          }
          else {
            sessionNetUSD[item.sessionId].dateMin = new Date(Math.min(
              new Date(sessionNetUSD[item.sessionId].dateMin),
              new Date(item.createTime)
            )).toISOString();

            sessionNetUSD[item.sessionId].dateMax = new Date(Math.max(
              new Date(sessionNetUSD[item.sessionId].dateMax),
              new Date(item.createTime)
            )).toISOString();

            sessionNetUSD[item.sessionId].sessionLength =
              new Date(sessionNetUSD[item.sessionId].dateMax) -
              new Date(sessionNetUSD[item.sessionId].dateMin);
          }

          if (!roundTracker[item.roundId])
            roundTracker[item.roundId] = { buy: 0, payout: 0 };

          if (item.type === 'BuyIn') {
            roundTracker[item.roundId].buy = amountInUSD;
          }
          else if (item.type === 'PayOut') {
            roundTracker[item.roundId].payout = amountInUSD;
          }

          //Process game round
          if (roundTracker[item.roundId].buy && roundTracker[item.roundId].payout) {
            let buyAmount = roundTracker[item.roundId].buy;
            let payoutAmount = roundTracker[item.roundId].payout;

            // Calculate multiplier for round
            let roundMultiplier = (payoutAmount / buyAmount);

            if (stats[gameName].bestMulti < roundMultiplier)
              stats[gameName].bestMulti = roundMultiplier;

            if (stats[gameName].bestWinUSD < payoutAmount)
              stats[gameName].bestWinUSD = payoutAmount;
          }

          // Handle BuyIn and PayOut types
          if (item.type === 'BuyIn') {
            const dateCreateTime = new Date(createTime);
            if (dateCreateTime >= sevenDaysAgo && dateCreateTime <= now) {
              overallStats.lossesUSD7Days += amountInUSD;
            }

            stats[gameName].netUSD -= amountInUSD;
            stats[gameName].plays++;
            stats[gameName].lossesUSD += amountInUSD;

            providerStats[providerAndStudio].netUSD -= amountInUSD;
            providerStats[providerAndStudio].plays++;
            providerStats[providerAndStudio].lossesUSD += amountInUSD;

            overallStats.lossesUSD += amountInUSD;
            overallStats.netUSD -= amountInUSD;

            overallStats.gameType[game.type].lossesUSD += amountInUSD;
            overallStats.gameType[game.type].netUSD -= amountInUSD;
            overallStats.gameType[game.type].plays++;

            dailyNetUSD[date].netUSD -= amountInUSD;
            dailyNetUSD[date].plays++;
            dailyNetUSD[date].betSize += amountInUSD;

            sessionNetUSD[item.sessionId].netUSD -= amountInUSD;
            sessionNetUSD[item.sessionId].plays++;
            sessionNetUSD[item.sessionId].betSize += amountInUSD;

          } else if (item.type === 'PayOut') {
            stats[gameName].winsUSD += amountInUSD;
            stats[gameName].netUSD += amountInUSD;
            stats[gameName].payouts++;

            providerStats[providerAndStudio].winsUSD += amountInUSD;
            providerStats[providerAndStudio].netUSD += amountInUSD;
            providerStats[providerAndStudio].payouts++;

            overallStats.winsUSD += amountInUSD;
            overallStats.netUSD += amountInUSD;

            overallStats.gameType[game.type].winsUSD += amountInUSD;
            overallStats.gameType[game.type].netUSD += amountInUSD;
            overallStats.gameType[game.type].payouts++;

            dailyNetUSD[date].netUSD += amountInUSD;

            sessionNetUSD[item.sessionId].netUSD += amountInUSD;
          }
          else if (item.type === 'Rollback') {
            //refund player
            //handle this later
            console.log(`Transaction rollback occurred for a ${game.type}.`);
          }
        }
        else if (item.type === 'ScheduledLeaderboardWin') {
          let amount = parseFloat(item.data.prizeTotal.amount);

          if (item.data.prizeTotal.currencyCode === 'ETH')
            amount = convertEthToUSD(amount, item.createTime);

          let monthKey = getMonthKey(item.createTime);
          if (!rewardsByMonth[monthKey]) rewardsByMonth[monthKey] = 0;
          rewardsByMonth[monthKey] += amount;

        } else if (item.type === 'TipReceived') {
          /*
          the "TipsReceived" data structure does not include currency code
          Sample Below:
          {
            id: 0,
            type: 'TipReceived',
            data: { from: { id: 15, displayName: 'SKEL_0x' }, amount: 0.0029 },
            read: false,
            createTime: '2024-06-01T18:09:55.877Z',
            updateTime: '2024-06-01T18:09:55.877Z'
          }
          
          If other currencies are being used and currencyCode is not specified,
          then tips will be impossible to handle. So far I've only received ETH tips.
          
          TODO: Update this logic if other currencies are sent this way
          */

          const ethAmount = parseFloat(item.data.amount);

          const amount = convertEthToUSD(ethAmount, item.createTime);

          let monthKey = getMonthKey(item.createTime);
          if (!rewardsByMonth[monthKey]) rewardsByMonth[monthKey] = 0;
          rewardsByMonth[monthKey] += amount;

        }
        else if (item.type === 'Cash') {
          //only include claimed amounts
          if (item.claimed === false) return;

          let amount = parseFloat(item.amount);

          if (item.currencyCode === 'ETH')
            amount = convertEthToUSD(amount, item.createTime);

          let monthKey = getMonthKey(item.createTime);
          if (!rewardsByMonth[monthKey]) rewardsByMonth[monthKey] = 0;
          rewardsByMonth[monthKey] += amount;

        } else if (item.type === 'Funds' || item.type === 'InventoryFunds') {
          //Must be Playable/Completed
          //these are winbacks/boost codes (based on item.sourceType)
          if ((item.status !== 'Completed' && item.status !== 'Claimed') || item.cashType !== 'Playable')
            return;

          let amount = parseFloat(item.amount);

          if (item.currencyCode === 'ETH') {
            amount = convertEthToUSD(amount, item.createTime);
          } else if (item.currencyCode !== 'USDT' && item.currencyCode !== 'USDC') {
            console.log("reward currency in " + item.currencyCode);
          }

          let monthKey = getMonthKey(item.createTime);

          if (!rewardsByMonth[monthKey]) rewardsByMonth[monthKey] = 0;
          rewardsByMonth[monthKey] += amount;
        }
        else if (item.type === 'TradingOrderClosed') {
          //TODO HODL game, future support 
        }
        else {
          //console.log(`Unknown type ${item.type}`);
        }
      });
    });

    batchData.length = 0;
  }

  console.log("Data processing completed.");

  return { stats, providerStats, overallStats, dailyNetUSD, sessionNetUSD, gameInfo };
}

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatCurrency(value) {
  return usdFormatter.format(value);
}

function formatNumber(number) {
  return new Intl.NumberFormat('en-US').format(number);
}

function prepareReport(stats, providerStats, overallStats, dailyNetUSD, sessionNetUSD, gameInfo) {
  console.log('\nCalculating Game Statistics:');

  for (const gameName in stats) {
    if (stats.hasOwnProperty(gameName)) {
      reportGameData.push({
        gameName,
        thumbnail: gameInfo[gameName].thumbnail,
        plays: stats[gameName].plays,
        payouts: stats[gameName].payouts,
        totalWagered: stats[gameName].lossesUSD,
        averageBet: stats[gameName].lossesUSD / stats[gameName].plays,
        bestMulti: stats[gameName].bestMulti,
        bestWinUSD: stats[gameName].bestWinUSD,
        netUSD: stats[gameName].netUSD,
        rtpPercent: stats[gameName].lossesUSD !== 0 ? ((stats[gameName].winsUSD / stats[gameName].lossesUSD) * 100) : 0,
      });
    }
  }

  console.log('\nCalculating overall stats by provider');

  for (const provider in providerStats) {
    const { winsUSD, lossesUSD, netUSD, plays } = providerStats[provider];;

    reportProviderStats.push({
      provider,
      plays,
      totalWagered: lossesUSD,
      averageBet: lossesUSD / plays,
      netUSD,
      rtp: ((winsUSD / lossesUSD) * 100).toFixed(2)
    });
  }

  reportProviderStats.sort((a, b) => a.provider.localeCompare(b.provider));

  console.log('\nCalculating overall stats by game type');

  for (const gameType in overallStats.gameType) {

    const { winsUSD, lossesUSD, netUSD, plays } = overallStats.gameType[gameType];

    reportOverallStatsByGameType.push({
      gameType,
      plays,
      totalWagered: lossesUSD,
      averageBet: lossesUSD / plays,
      netUSD,
      rtp: ((winsUSD / lossesUSD) * 100).toFixed(2)
    });
  }

  //Session Grouping
  const allSessions = Object.keys(sessionNetUSD)
    .sort((a, b) => b - a);


  allSessions.forEach(sessionId => {

    let averageBet = sessionNetUSD[sessionId].betSize / sessionNetUSD[sessionId].plays;
    let totalBets = averageBet * sessionNetUSD[sessionId].plays;
    const sessionRTP = averageBet > 0 ? ((sessionNetUSD[sessionId].netUSD + totalBets) / totalBets) * 100 : 0;

    let totalSessionMinutes = Math.ceil(sessionNetUSD[sessionId].sessionLength / 60000);
    const sessionHours = Math.floor(totalSessionMinutes / 60);
    const sessionMinutes = totalSessionMinutes % 60;
    const currentSessionDate = getTimeDate(sessionNetUSD[sessionId].date);

    reportSessionStats.push({
      sessionId,
      date: currentSessionDate,
      plays: sessionNetUSD[sessionId].plays,
      averageBet,
      totalWagered: totalBets,
      netUSD: sessionNetUSD[sessionId].netUSD,
      rtp: sessionRTP,
      timePlayed: `${sessionHours}h ${sessionMinutes}m`
    });
  });

  const allDates = Object.keys(dailyNetUSD)
    .sort((a, b) => new Date(b) - new Date(a));

  console.log('\nCalculating Daily Statistics');

  // Grouping by month
  const monthlyStats = {};

  allDates.forEach(date => {
    let averageBet = dailyNetUSD[date].betSize / dailyNetUSD[date].plays;
    let totalBets = averageBet * dailyNetUSD[date].plays;
    const dailyRTP = averageBet > 0 ? ((dailyNetUSD[date].netUSD + totalBets) / totalBets) * 100 : 0;

    reportDailyStats.push({
      date,
      plays: dailyNetUSD[date].plays,
      averageBet,
      totalWagered: totalBets,
      netUSD: dailyNetUSD[date].netUSD,
      rtp: dailyRTP
    });

    const formatMonthYear = (date) => {
      const [year, month] = date.split('-');
      return `${year}-${month}`;
    };

    // Monthly stats for all data
    const monthKey = formatMonthYear(date);
    if (!monthlyStats[monthKey]) {
      monthlyStats[monthKey] = {
        netUSD: 0,
        plays: 0,
        totalBetSize: 0,
        totalWagered: 0,
        totalRewards: 0,
      };
    }

    monthlyStats[monthKey].netUSD += dailyNetUSD[date].netUSD;
    monthlyStats[monthKey].plays += dailyNetUSD[date].plays;
    monthlyStats[monthKey].totalBetSize += dailyNetUSD[date].betSize;
    monthlyStats[monthKey].totalWagered += totalBets;
    monthlyStats[monthKey].totalRewards = rewardsByMonth[monthKey] ?? 0;
  });

  console.log('\nCalculating Monthly Statistics');
  Object.keys(monthlyStats)
    .sort((a, b) => new Date(b) - new Date(a))
    .forEach(month => {
      const { netUSD, plays, totalBetSize, totalWagered, totalRewards } = monthlyStats[month];
      const averageBet = plays > 0 ? totalBetSize / plays : 0;
      const monthlyRTP = averageBet > 0 ? ((netUSD + totalWagered) / totalWagered) * 100 : 0;

      reportMonthlyStats.push({
        month,
        plays,
        averageBet,
        totalWagered,
        totalRewards,
        netUSD,
        rtp: monthlyRTP,
      });

      overallStats.rewards += totalRewards;
    });
}

function formatProviderAndStudio(providerName, studio) {
  if (!studio || providerName.toLowerCase() === studio.name.toLowerCase()) {
    return providerName;
  }
  return studio.name.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}


function createDataFolder() {
  const dataFolder = path.join(__dirname, 'data');
  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder);
  }
}

function createOutputFolder() {
  const outputFolder = path.join(__dirname, 'output');
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder);
  }
}

/*
Handles the case of direct compensations not tracked from history
This includes cases such as payout malfunctions that are later compensated by customer support
Or direct compensation by MetaWin for VIP customers
*/
const loadUntrackedRewards = () => {
  const path = './untracked-rewards.json';
  if (fs.existsSync(path)) {
    try {
      const data = fs.readFileSync(path, 'utf-8');
      const rewards = JSON.parse(data);
      return rewards || {};
    } catch {
      return {};
    }
  } else {
    return {};
  }
};

async function findFirstActivity() {
  let start = new Date('2021-01-01');
  const today = new Date();

  while (start < today) {
    let end = new Date(start);
    end.setMonth(end.getMonth() + 6);
    if (end > today) end = new Date(today); // Don't go past today

    const fromISO = formatDate(start);
    const toISO = formatDate(end);

    let data = await fetchDataV2(fromISO, toISO, 1, 0, 0);

    if (data?.totalCount > 0) {
      return data.items[data.items.length - 1].createTime;
    }

    // Move to next 6-month window
    start = end;
  }

  console.log("No activity found before today");
  return null;
}

async function main() {
  createDataFolder();
  createOutputFolder();

  const untrackedRewards = loadUntrackedRewards();
  for (const [month, reward] of Object.entries(untrackedRewards)) {
    rewardsByMonth[month] = reward;
  }

  try {
    console.log("Fetching ETH rate table...");
    ethRates = await fetchEthRates();
  }
  catch (err) {
    console.log("Error occurred fetching eth rates:");
    console.error(err);
  }

  try {
    console.log("Downloading rewards...");
    for (const urlType in METAWIN_ENDPOINTS) {
      if (urlType === 'HILO' || urlType === 'REKT')
        await updateLocalFilesForMiniGames(urlType);
      else
        await updateLocalFiles(urlType);
    }
    console.log("Updating local files complete");
  }
  catch {
    console.log("Cannot retrieve new data, need token");
  }

  console.log("Downloading history files...");

  let latestDay = deleteLatestHistoryDay();

  if (!latestDay) {
    latestDay = await findFirstActivity();
  }

  if (!latestDay) {
    console.log("Cannot generate report. Cannot find history for this account.");
    return;
  }

  await downloadHistory(latestDay);

  console.log("Reading data files");
  const localData = readAllDataFromLocalFiles();
  console.log("Reading Data files complete");

  if (localData.length > 0) {
    const { stats, providerStats, overallStats, dailyNetUSD, sessionNetUSD, gameInfo } = processData(localData);

    prepareReport(stats, providerStats, overallStats, dailyNetUSD, sessionNetUSD, gameInfo);

    try {
      ejs.renderFile('results_template.ejs', {
        reportOverallStatsByGameType: reportOverallStatsByGameType,
        reportMonthlyStats: reportMonthlyStats,
        reportDailyStats: reportDailyStats,
        reportSessionStats: reportSessionStats,
        reportGameData: reportGameData,
        reportProviderStats: reportProviderStats,
        overallStats: overallStats,
        formatMultiplier: function (amount) {
          return amount.toFixed(0);
        },
        formatCurrency: function (amount) {
          return formatCurrency(amount);
        },
        formatNumber: function (amount) {
          return formatNumber(amount);
        },
        formatPercentage: function (value) {
          return new Intl.NumberFormat('en-US', {
            style: 'percent',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(value / 100);
        },
        formatMonthYear: function (dateValue) {
          const [year, month] = dateValue.split('-').map(Number);
          const date = new Date(year, month - 1); // Month is 0-indexed
          const formatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' });
          return formatter.format(date);
        }
      }, (err, str) => {
        if (err) {
          console.log("Error generating report:");
          console.error(err);
        } else {
          let filename = path.join(__dirname, 'output', 'latest_report.html');
          fs.writeFileSync(filename, str);
          console.log(`Report generated at ${filename}`);
        }
      });

    }
    catch (err) {
      console.log("Error generating report: " + err);
    }

  } else {
    console.log('No local data available.');
  }

}

main();


