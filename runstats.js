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
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10);

const METAWIN_ENDPOINTS = {
  HISTORY: 'https://api.prod.platform.metawin.com/game/action',
  NOTIFICATIONS: 'https://api.prod.platform.metawin.com/notification',
  CLAIMS: 'https://api.prod.platform.metawin.com/inventory',
  REWARDS: 'https://api.prod.platform.metawin.com/reward',
  HILO: 'https://api.prod.platform.mwapp.io/game/history/hilo',
  REKT: 'https://api.prod.platform.mwapp.io/game/history/crash'
};

const REKT_IMAGE_URL = "https://content.prod.platform.mwapp.io/games/NEWREKT.png";
const HILO_IMAGE_URL = "https://content.prod.platform.mwapp.io/games/NEWHILO.png";

const headers = {
  'Origin': 'https://metawin.com',
  'Authorization': 'Bearer ' + TOKEN_BEARER
};

const ethRates = {};
const now = new Date();
const sevenDaysAgo = new Date(now);
sevenDaysAgo.setDate(now.getDate() - 7);

//used for month arrays
const getMonthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

let rewardsByMonth = [];
let reportOverallStatsByGameType = [];
let reportDailyStats = [];
let reportSessionStats = [];
let reportProviderStats = [];
let reportMonthlyStats = [];
let reportGameData = [];

async function fetchData(apiUrl, page) {
  try {
    const response = await axios.get(`${apiUrl}?page=${page}&pageSize=${PAGE_SIZE}`, { headers });
    return response.data;
  } catch (error) {
    return null;
  }
}

function getNewestId(urlType) {
  const latestIdFile = path.join(__dirname, 'data', 'latest_id.json');

  if (fs.existsSync(latestIdFile)) {
    const data = JSON.parse(fs.readFileSync(latestIdFile, 'utf8'));

    return data[urlType] || 0;
  }

  return 0;
}

function saveNewestId(urlType, newestId) {
  const latestIdFile = path.join(__dirname, 'data', 'latest_id.json');

  let data = {};

  if (fs.existsSync(latestIdFile)) {
    data = JSON.parse(fs.readFileSync(latestIdFile, 'utf8'));
  }

  data[urlType] = newestId;

  // Write the updated data back to the file
  fs.writeFileSync(latestIdFile, JSON.stringify(data, null, 2));
}

async function saveData(urlType, data, page) {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  const timestamp = Date.now();
  const filePath = path.join(dir, `${urlType}_data_page_${page}_${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function upgradeLatestFileFormat() {
  const latestIdFile = path.join(__dirname, 'data', 'latest_id.json');
  const oldIdFile = path.join(__dirname, 'data', 'latest_id.txt');

  if (fs.existsSync(oldIdFile)) {
    const singleId = fs.readFileSync(oldIdFile, 'utf8');
    const initialData = {
      HISTORY: parseInt(singleId, 10),
      NOTIFICATIONS: 0,
      CLAIMS: 0,
      REWARDS: 0,
      HILO: 0,
      REKT: 0
    };
    // Save the new JSON format
    fs.writeFileSync(latestIdFile, JSON.stringify(initialData, null, 2));
    // Delete the old format file
    fs.unlinkSync(oldIdFile);
  }
}

async function updateLocalFiles(urlType) {

  const apiUrl = METAWIN_ENDPOINTS[urlType];
  const newestId = getNewestId(urlType);

  try {
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

    const totalPages = firstPageData.pageCount;

    let maxId = Math.max(...newItems.map(item => item.id));
    saveNewestId(urlType, maxId);

    for (let page = 2; page <= totalPages; page++) {
      console.log(`Retrieving data for ${urlType} (${page} of ${totalPages})`);

      const pageData = await fetchData(METAWIN_ENDPOINTS[urlType], page);

      if (pageData) {
        if (newestId && pageData.items.some(item => item.id <= newestId)) {
          const newItems = pageData.items.filter(item => item.id > newestId);
          pageData.items = newItems;
          await saveData(urlType, pageData, page);
          console.log("No additional pages needed and can be skipped!");
          break;
        } else {
          await saveData(urlType, pageData, page);
        }
      }
    }

  } catch (error) {
    console.log(`Cannot retrieve new data for ${urlType}, need token`);
  }
}

async function updateLocalFilesForMiniGames(urlType) {

  const apiUrl = METAWIN_ENDPOINTS[urlType];
  const newestId = getNewestId(urlType);

  try {
    console.log(`Retrieving data for ${urlType}...`);

    const firstPageData = await fetchData(apiUrl, 1);
    if (!firstPageData) {
      console.log(`Error fetching new data for ${urlType}.`);
      return;
    }

    const newItems = firstPageData.items.filter(item => item.createTime > newestId);

    if (newItems.length > 0) {
      console.log(newItems);
      firstPageData.items = newItems;
      await saveData(urlType, firstPageData, 1);
    } else {
      console.log(`${urlType} already up to date.`);
      return;
    }

    console.log(`New data incoming for ${urlType}.`);

    const totalPages = firstPageData.pageCount;

    let maxId = Math.max(...newItems.map(item => item.createTime));
    saveNewestId(urlType, maxId);

    for (let page = 2; page <= totalPages; page++) {
      console.log(`Retrieving data for ${urlType} (${page} of ${totalPages})`);

      const pageData = await fetchData(METAWIN_ENDPOINTS[urlType], page);

      if (pageData) {
        if (newestId && pageData.items.some(item => item.createTime <= newestId)) {
          const newItems = pageData.items.filter(item => item.createTime > newestId);
          pageData.items = newItems;
          await saveData(urlType, pageData, page);
          console.log("No additional pages needed and can be skipped!");
          break;
        } else {
          await saveData(urlType, pageData, page);
        }
      }
    }

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

          //TODO: cannot currently handle other currencies without rate table
          if (providerCurrency.code !== "USD") return;

          let gameName = game.name;

          // Normalize game names
          if (gameName.startsWith("Baccarat") && game.type === "LiveCasino") {
            gameName = "Baccarat";
          } else if (gameName.startsWith("Blackjack") && game.type === "LiveCasino") {
            gameName = "Blackjack";
          } else if (gameName.startsWith("Roulette") && game.type === "LiveCasino") {
            gameName = "Roulette";
          }

          const amountInUSD = parseFloat(providerCurrency.amount);
          const date = getTimeDate(createTime);
          const justTheDate = new Date(createTime).toISOString().split('T')[0];

          // Store ETH rate per day
          if (!ethRates[justTheDate]) {
            ethRates[justTheDate] = parseFloat(providerCurrency.rate);
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

          if (item.data.prizeTotal.currencyCode === 'ETH') {
            let ethRate = ethRates[item.createTime];
            if (!ethRate) {
              // Find closest date's rate if not found
              ethRate = findClosestRate(item.createTime);
            }
            // Convert ETH to USD using the rate
            amount *= ethRate;
          }

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
          let ethRate = ethRates[item.createTime];
          if (!ethRate) {
            // Find closest date's rate if not found
            ethRate = findClosestRate(item.createTime);
          }
          const amount = ethAmount * ethRate;

          let monthKey = getMonthKey(item.createTime);
          if (!rewardsByMonth[monthKey]) rewardsByMonth[monthKey] = 0;
          rewardsByMonth[monthKey] += amount;

        }
        else if (item.type === 'Cash') {
          //only include claimed amounts
          if (item.claimed === false) return;

          let amount = parseFloat(item.amount);

          if (item.currencyCode === 'ETH') {
            let ethRate = ethRates[item.createTime];
            if (!ethRate) {
              // Find closest date's rate if not found
              ethRate = findClosestRate(item.createTime);
            }
            // Convert ETH to USD using the rate
            amount *= ethRate;
          }

          let monthKey = getMonthKey(item.createTime);
          if (!rewardsByMonth[monthKey]) rewardsByMonth[monthKey] = 0;
          rewardsByMonth[monthKey] += amount;

        } else if (item.type === 'Funds' || item.type === 'InventoryFunds') {
          //Must be Playable/Completed
          //these are winbacks/boost codes (based on item.sourceType)
          if (item.status !== 'Completed' || item.cashType !== 'Playable')
            return;

          let amount = parseFloat(item.amount);

          if (item.currencyCode === 'ETH') {
            let ethRate = ethRates[item.createTime];
            if (!ethRate) {
              // Find closest date's rate if not found
              ethRate = findClosestRate(item.createTime);
            }
            // Convert ETH to USD using the rate
            amount *= ethRate;
          } else if (item.currencyCode !== 'USDT') {
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
          console.log(`Unknown type ${item.type}`);
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
  if (!studio || providerName.toLowerCase() === studio.toLowerCase()) {
    return providerName;
  }
  return studio.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function findClosestRate(date) {
  const availableDates = Object.keys(ethRates);
  let closestDate = availableDates[0];

  availableDates.forEach(d => {
    if (Math.abs(new Date(d) - new Date(date)) < Math.abs(new Date(closestDate) - new Date(date))) {
      closestDate = d;
    }
  });

  return ethRates[closestDate];
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

async function main() {
  createDataFolder();
  createOutputFolder();
  upgradeLatestFileFormat();

  const untrackedRewards = loadUntrackedRewards();
  for (const [month, reward] of Object.entries(untrackedRewards)) {
    rewardsByMonth[month] = reward;
  }

  try {
    console.log("Updating local files...");
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