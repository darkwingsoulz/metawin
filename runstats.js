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
};

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
let reportOverallStatsByCurrency = [];
let reportOverallStatsByGameType = [];
let reportDailyStats = [];
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
    };
    // Save the new JSON format
    fs.writeFileSync(latestIdFile, JSON.stringify(initialData, null, 2));
    // Delete the old format file
    fs.unlinkSync(oldIdFile);
  }
}

async function updateLocalFiles() {
  console.log("Updating local files...");

  for (const urlType in METAWIN_ENDPOINTS) {
    const apiUrl = METAWIN_ENDPOINTS[urlType];
    const newestId = getNewestId(urlType);

    try {
      console.log(`Retrieving data for ${urlType}...`);

      const firstPageData = await fetchData(apiUrl, 1);
      if (!firstPageData) {
        console.log(`Error fetching new data for ${urlType}.`);
        continue;
      }

      const newItems = firstPageData.items.filter(item => item.id > newestId);

      if (newItems.length > 0) {
        firstPageData.items = newItems;
        await saveData(urlType, firstPageData, 1);
      } else {
        console.log(`${urlType} already up to date.`);
        continue;
      }

      console.log(`New data incoming for ${urlType}.`);

      const totalPages = firstPageData.pageCount;
      let maxId = Math.max(...newItems.map(item => item.id));
      saveNewestId(urlType, maxId);

      for (let page = 2; page <= totalPages; page++) {
        console.log(`Retrieving data for ${urlType} (${page} of ${totalPages})`);

        const pageData = await fetchData(METAWIN_ENDPOINTS.HISTORY, page);

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

  console.log("Updating local files complete");
}

function readAllDataFromLocalFiles() {
  const dir = path.join(__dirname, 'data');
  const historyData = [];
  const otherData = [];

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
  const gameInfo = {};
  const totalBatches = Math.ceil(allData.length / BATCH_SIZE);

  for (let batch = 0; batch < totalBatches; batch++) {
    console.log(`Processing batch ${batch + 1} of ${totalBatches}`);

    // Slice the data into smaller batches
    const batchData = allData.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);

    // Process each batch individually
    batchData.forEach(data => {
      data.items.forEach(item => {

        //TODO: maybe handle competition entries at some point
        if (item.type === 'SweepstakeEntry') return;

        if (item.type === 'BuyIn' || item.type === 'PayOut') {
          const { currencyCode, game, providerCurrency, createTime } = item;

          //TODO: cannot currently handle other currencies without rate table
          if (providerCurrency.code !== "USD") return;

          let gameName = game.name;

          // Normalize game names
          if (gameName.startsWith("Baccarat") && game.type === "LiveCasino") {
            gameName = "Baccarat";
          } else if (gameName.startsWith("Blackjack") && game.type === "LiveCasino") {
            gameName = "Blackjack";
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
          if (!providerStats[providerAndStudio]) {
            providerStats[providerAndStudio] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };
          }
          //game stats
          if (!stats[gameName]) stats[gameName] = {};
          if (!gameInfo[gameName]) gameInfo[gameName] = { thumbnail: game.thumbnail };
          if (!stats[gameName][currencyCode]) {
            stats[gameName][currencyCode] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };
          }
          //overall stats
          if (!overallStats.currencies[currencyCode]) {
            overallStats.currencies[currencyCode] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };
          }
          if (!overallStats.gameType[game.type]) {
            overallStats.gameType[game.type] = { plays: 0, payouts: 0, winsUSD: 0, lossesUSD: 0, netUSD: 0 };
          }

          if (!dailyNetUSD[date]) {
            dailyNetUSD[date] = { netUSD: 0, plays: 0, betSize: 0 };
          }

          // Handle BuyIn and PayOut types
          if (item.type === 'BuyIn') {
            const dateCreateTime = new Date(createTime);
            if (dateCreateTime >= sevenDaysAgo && dateCreateTime <= now) {
              overallStats.lossesUSD7Days += amountInUSD;
            }
            processBuyIn(stats, providerStats, providerAndStudio, overallStats, dailyNetUSD, gameName, currencyCode, amountInUSD, date, game);
          } else if (item.type === 'PayOut') {
            processPayOut(stats, providerStats, providerAndStudio, overallStats, dailyNetUSD, gameName, currencyCode, amountInUSD, date, game);
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
          overallStats.rewards += amount;
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
          overallStats.rewards += amount;
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
          overallStats.rewards += amount;
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
          overallStats.rewards += amount;
        }
        else {
          console.log(`Unknown type ${item.type}`);
        }
      });
    });

    batchData.length = 0;
  }

  console.log("Data processing completed.");

  return { stats, providerStats, overallStats, dailyNetUSD, gameInfo };
}

function processBuyIn(stats, providerStats, providerAndStudio, overallStats, dailyNetUSD, gameName, currencyCode, amountInUSD, date, game) {
  stats[gameName][currencyCode].netUSD -= amountInUSD;
  stats[gameName][currencyCode].plays++;
  stats[gameName][currencyCode].lossesUSD += amountInUSD;

  providerStats[providerAndStudio].netUSD -= amountInUSD;
  providerStats[providerAndStudio].plays++;
  providerStats[providerAndStudio].lossesUSD += amountInUSD;

  overallStats.currencies[currencyCode].netUSD -= amountInUSD;
  overallStats.currencies[currencyCode].plays++;
  overallStats.currencies[currencyCode].lossesUSD += amountInUSD;
  overallStats.lossesUSD += amountInUSD;
  overallStats.netUSD -= amountInUSD;

  overallStats.gameType[game.type].lossesUSD += amountInUSD;
  overallStats.gameType[game.type].netUSD -= amountInUSD;
  overallStats.gameType[game.type].plays++;

  dailyNetUSD[date].netUSD -= amountInUSD;
  dailyNetUSD[date].plays++;
  dailyNetUSD[date].betSize += amountInUSD;
}

function processPayOut(stats, providerStats, providerAndStudio, overallStats, dailyNetUSD, gameName, currencyCode, amountInUSD, date, game) {
  stats[gameName][currencyCode].winsUSD += amountInUSD;
  stats[gameName][currencyCode].netUSD += amountInUSD;
  stats[gameName][currencyCode].payouts++;

  providerStats[providerAndStudio].winsUSD += amountInUSD;
  providerStats[providerAndStudio].netUSD += amountInUSD;
  providerStats[providerAndStudio].payouts++;

  overallStats.currencies[currencyCode].winsUSD += amountInUSD;
  overallStats.currencies[currencyCode].netUSD += amountInUSD;
  overallStats.currencies[currencyCode].payouts++;

  overallStats.winsUSD += amountInUSD;
  overallStats.netUSD += amountInUSD;

  overallStats.gameType[game.type].winsUSD += amountInUSD;
  overallStats.gameType[game.type].netUSD += amountInUSD;
  overallStats.gameType[game.type].payouts++;

  dailyNetUSD[date].netUSD += amountInUSD;
}

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatCurrency(value) {
  return usdFormatter.format(value);
}

function formatNumber(number) {
  return new Intl.NumberFormat('en-US').format(number);
}

function prepareReport(stats, providerStats, overallStats, dailyNetUSD, gameInfo) {

  function calculateGameNetUSD(gameStats) {
    let gameNetUSD = 0;
    for (const currencyCode in gameStats) {
      const { netUSD } = gameStats[currencyCode];
      gameNetUSD += netUSD;
    }
    return gameNetUSD;
  }

  const gameNames = Object.keys(stats).sort();

  const gameNetUSDArr = gameNames.map(gameName => ({
    gameName,
    gameNetUSD: calculateGameNetUSD(stats[gameName]),
  }));

  gameNetUSDArr.sort((a, b) => b.gameNetUSD - a.gameNetUSD);

  console.log('\nCalculating Game Statistics:');

  for (const { gameName } of gameNetUSDArr) {
    let gameNetUSD = 0;

    const currencySections = [];

    for (const currencyCode in stats[gameName]) {
      const { winsUSD, lossesUSD, netUSD, plays, payouts } = stats[gameName][currencyCode];

      currencySections.push({
        currencyCode,
        plays,
        payouts,
        totalWagered: lossesUSD,
        averageBet: lossesUSD / plays,
        netUSD: netUSD,
        rtpPercent: ((winsUSD / lossesUSD) * 100),
      });
      gameNetUSD += netUSD;
    }

    reportGameData.push({
      gameName,
      thumbnail: gameInfo[gameName].thumbnail,
      currencySections,
      totalNetUSD: gameNetUSD
    });
  }

  console.log('\nCalculating overall stats by currency');

  for (const currencyCode in overallStats.currencies) {
    const { winsUSD, lossesUSD, netUSD, plays } = overallStats.currencies[currencyCode];;

    reportOverallStatsByCurrency.push({
      currencyCode,
      plays,
      totalWagered: lossesUSD,
      averageBet: lossesUSD / plays,
      netUSD,
      rtp: ((winsUSD / lossesUSD) * 100).toFixed(2)
    });
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

    // Monthly stats for all data
    const monthKey = getMonthKey(date);
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

async function main() {
  createDataFolder();
  createOutputFolder();

  upgradeLatestFileFormat();

  try {
    await updateLocalFiles();
  }
  catch {
    console.log("Cannot retrieve new data, need token");
  }

  console.log("Reading data files");
  const localData = readAllDataFromLocalFiles();
  console.log("Reading Data files complete");
  if (localData.length > 0) {
    const { stats, providerStats, overallStats, dailyNetUSD, gameInfo } = processData(localData);

    prepareReport(stats, providerStats, overallStats, dailyNetUSD, gameInfo);

    try {
      ejs.renderFile('results_template.ejs', {
        reportOverallStatsByCurrency: reportOverallStatsByCurrency,
        reportOverallStatsByGameType: reportOverallStatsByGameType,
        reportMonthlyStats: reportMonthlyStats,
        reportDailyStats: reportDailyStats,
        reportGameData: reportGameData,
        reportProviderStats: reportProviderStats,
        overallStats: overallStats,
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