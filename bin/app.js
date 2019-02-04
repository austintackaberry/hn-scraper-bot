var fetch = require("node-fetch");
const cheerio = require("cheerio");
const rp = require("request-promise");
const {
  callSelectQuery,
  clearDatabase,
  insertIntoDatabase
} = require("./database");

updateDatabase();

async function updateDatabase() {
  let options = {
    uri: "https://news.ycombinator.com/submitted?id=whoishiring",
    transform: body => {
      return cheerio.load(body);
    }
  };
  let $ = await rp(options);
  const firstPageDetails = getLatestWhoIsHiringLink($);
  options = {
    uri: firstPageDetails.whoIsHiringLink,
    transform: body => {
      return cheerio.load(body);
    }
  };
  $ = await rp(options);
  let results;
  console.log("Getting all current documents...");
  try {
    results = await callSelectQuery();
  } catch (err) {
    console.log(err);
  }
  console.log("Getting data from hacker news...");
  const { dbValues, geocodeFns } = getDbValues(
    $,
    results,
    firstPageDetails.month
  );
  console.log("Generating geocode fns...");
  const asyncHnLocationFnBatches = setUpGeocodeFns(geocodeFns);
  console.log("Executing geocode fns...");
  await runGeocodeFns(asyncHnLocationFnBatches);
  console.log("Clearing db...");
  await clearDatabase(dbValues);
  console.log("Inserting values into db...");
  try {
    await insertIntoDatabase(dbValues);
  } catch (err) {
    console.log(err);
  }
}

// HELPER FUNCTIONS

function hackerNewsFormatTimePosted(timeString) {
  let timeArr = timeString.split(" ");
  let dateNow = new Date();

  let timeNow = dateNow.getTime();
  let postTime = timeNow;

  if (timeArr[1] == "seconds") {
    postTime -= timeArr[0] * 1000;
  } else if (timeArr[1] == "minutes") {
    postTime -= timeArr[0] * 60 * 1000;
  } else if (timeArr[1] == "hours") {
    postTime -= timeArr[0] * 60 * 60 * 1000;
  } else if (timeArr[1] == "days") {
    postTime -= timeArr[0] * 24 * 60 * 60 * 1000;
  }
  if (timeArr[1] == "years") {
    postTime -= timeArr[0] * 365 * 24 * 60 * 60 * 1000;
  }
  return postTime;
}

function setUpGeocodeFns(geocodeFns) {
  let i = 0;
  const asyncHnLocationFnBatches = [];
  while (i < geocodeFns.length) {
    let end;
    if (i + 48 > geocodeFns.length) {
      end = geocodeFns.length;
    } else {
      end = i + 48;
    }
    let shortGeocodeFns = geocodeFns.slice(i, end);
    i = end;
    asyncHnLocationFnBatches.push(async function() {
      await Promise.all(
        shortGeocodeFns.map(async fn => {
          await fn();
        })
      );
      return Promise.resolve(true);
    });
    asyncHnLocationFnBatches.push(async function() {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve(true);
        }, 1000);
      });
    });
  }
  return asyncHnLocationFnBatches;
}

async function runGeocodeFns(asyncHnLocationFnBatches) {
  try {
    for (let fn of asyncHnLocationFnBatches) {
      await fn();
    }
    return Promise.resolve(true);
  } catch (err) {
    console.log(err);
  }
}

function getLatestWhoIsHiringLink($) {
  let month;
  let whoIsHiringLink;
  $(".storylink").each(function(index, value) {
    let text = $(this).text();
    if (text.includes("Who is hiring?")) {
      [month] = text.match(/\(.*\)/);
      whoIsHiringLink = `https://news.ycombinator.com/${value.attribs.href}`;
      return false;
    }
  });
  return { whoIsHiringLink: whoIsHiringLink, month: month };
}

function getDbValues($, results, month) {
  const dbValues = [];
  const geocodeFns = [];
  $(".c00").each(function() {
    let text = $(this).text();
    let topLine = $($(this).contents()[0]).text();
    let listingInfo = topLine.split("|");
    let descriptionText;
    if (listingInfo.length > 1) {
      let i = 0;
      let descriptionHTML;
      let fullPost = $(this);
      fullPost.find(".reply").remove();
      fullPost = fullPost.html();
      let postTime = $(this)
        .parents()
        .eq(2)
        .find(".age")
        .text();
      let postTimeInMs = hackerNewsFormatTimePosted(postTime);
      let source = "hackerNews";
      let fullPostText = text;
      descriptionHTML = fullPost;
      let url, compensation, title, type;
      let location = false;
      if ($($(this).contents()[1]).attr("href")) {
        url = $($(this).contents()[1]).attr("href");
        descriptionText = $(
          $(this)
            .contents()
            .slice(2)
        ).text();
      } else {
        descriptionText = $(
          $(this)
            .contents()
            .slice(1)
        ).text();
      }
      let companyName = listingInfo.shift();
      while (i < listingInfo.length) {
        if (listingInfo[i].includes("http")) {
          url = listingInfo.splice(i, 1);
        } else if (/%|salary|€|\$|£|[0-9][0-9]k/.test(listingInfo[i])) {
          [compensation] = listingInfo.splice(i, 1);
        } else if (
          /position|engineer|developer|senior|junior|scientist|analyst/i.test(
            listingInfo[i]
          ) &&
          listingInfo[i].length < 200
        ) {
          [title] = listingInfo.splice(i, 1);
        } else if (
          /permanent|intern|flexible|remote|on\W*site|part\Wtime|full\Wtime|full/i.test(
            listingInfo[i]
          ) &&
          listingInfo[i].length < 200
        ) {
          [type] = listingInfo.splice(i, 1);
        } else if (
          /boston|seattle|london|new york|san francisco|bay area|nyc|sf/i.test(
            listingInfo[i]
          ) &&
          listingInfo[i].length < 200
        ) {
          [location] = listingInfo.splice(i, 1);
        } else if (
          /\W\W[A-Z][a-zA-Z]/.test(listingInfo[i]) &&
          listingInfo[i].length < 200
        ) {
          [location] = listingInfo.splice(i, 1);
        } else if (
          /[a-z]\.[a-z]/i.test(listingInfo[i]) &&
          listingInfo[i].length < 200
        ) {
          [url] = `http://${listingInfo.splice(i, 1)}`;
        } else if (listingInfo[i] === " ") {
          listingInfo.splice(i, 1);
        } else {
          i++;
        }
      }
      const nextVal = {
        month,
        source,
        fullPostText,
        descriptionHTML,
        descriptionText,
        postTimeInMs,
        companyName,
        url,
        compensation,
        title,
        type,
        location
      };
      let validRow = {};
      results.some(rowFromDB => {
        let fullPostTestFromDB = new Buffer(rowFromDB.fullPostText).toString(
          "utf8"
        );
        if (fullPostTestFromDB === fullPostText && rowFromDB.latitude !== 0) {
          validRow = rowFromDB;
          return true;
        }
        return false;
      });
      const { latitude = null, longitude = null } = validRow;

      if (!longitude || !latitude) {
        geocodeFns.push(async function() {
          let data = await getGeocodeFetchData(location);
          if (!data.results[0]) {
            console.log(data);
            nextVal.latitude = null;
            nextVal.longitude = null;
          } else {
            nextVal.latitude = data.results[0].geometry.location.lat;
            nextVal.longitude = data.results[0].geometry.location.lng;
          }
          return Promise.resolve(true);
        });
      } else {
        nextVal.latitude = latitude;
        nextVal.longitude = longitude;
      }
      dbValues.push(nextVal);
    }
  });
  return { dbValues, geocodeFns };
}

async function getGeocodeFetchData(location) {
  if (!location) {
    return { results: [] };
  }
  try {
    let locationFormatted = location.replace(/[^a-zA-Z0-9-_]/g, " ");
    let geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${locationFormatted}&key=AIzaSyAFco2ZmRw5uysFTC4Eck6zXdltYMwb4jk`;
    const fetchRes = await fetch(encodeURI(geocodeUrl), {
      method: "GET"
    });
    const response = await fetchRes.json();
    return response;
  } catch (err) {
    console.log(err);
  }
}
