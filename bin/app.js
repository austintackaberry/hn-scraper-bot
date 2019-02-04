var fetch = require("node-fetch");
const cheerio = require("cheerio");
const rp = require("request-promise");
const mysql = require("mysql");

var connection = mysql.createConnection({
  host: "austintackaberry-jobsort.c3tu2houar8w.us-west-1.rds.amazonaws.com",
  user: "austintackaberry",
  password: process.env.MYSQL_PASSWORD,
  database: "jobsortdb",
  port: 3306,
  charset: "utf8mb4"
});

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
  const results = await callSelectQuery();
  const { dbValues, geocodeFns } = getDbValues(
    $,
    results,
    firstPageDetails.month
  );
  console.log("First dbValue length: ", dbValues[0].length);
  console.log("Generating geocode fns...");
  const asyncHnLocationFnBatches = setUpGeocodeFns(geocodeFns);
  console.log("First dbValue length: ", dbValues[0].length);
  console.log("Executing geocode fns...");
  await runGeocodeFns(asyncHnLocationFnBatches, dbValues);
  console.log("First dbValue length: ", dbValues[0].length);
  console.log("Clearing db...");
  await clearDatabase(dbValues);
  console.log("Inserting values into db...");
  try {
    await insertIntoDatabase(dbValues);
  } catch (err) {
    console.log(err);
  }
  connection.end();
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

async function clearDatabase(dbValues) {
  try {
    return new Promise((resolve, reject) => {
      const queryStringTruncate = "TRUNCATE `jobsortdb`.`hackerNewsListings`";
      connection.query(queryStringTruncate, [dbValues], function(error) {
        if (!error) {
          resolve(true);
        } else {
          reject(`TRUNCATE Query Error: ${error}`);
        }
      });
    });
  } catch (err) {
    console.log(err);
  }
}

async function insertIntoDatabase(dbValues) {
  const fixedDbValues = dbValues.map(val => {
    if (val.length === 12) {
      console.log("There was a whoopsy");
      return [...val, null, null];
    }
    return val;
  });
  return new Promise((resolve, reject) => {
    const queryStringInsert =
      "INSERT INTO hackerNewsListings (month, source, fullPostText, descriptionHTML, descriptionText, postTimeInMs, companyName, url, compensation, title, type, location, latitude, longitude) VALUES ?";
    connection.query(queryStringInsert, [fixedDbValues], function(error) {
      if (!error) {
        console.log("success!");
        resolve(true);
      } else {
        reject(`INSERT Query Error: ${error}`);
      }
    });
  });
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

async function callSelectQuery() {
  try {
    return new Promise(function(resolve, reject) {
      const queryStringSelect =
        "SELECT latitude, longitude, fullPostText FROM jobsortdb.hackerNewsListings";
      connection.query(queryStringSelect, function(error, results) {
        if (!error) {
          resolve(results);
        } else {
          reject(`SELECT Query Error: ${error}`);
        }
      });
    });
  } catch (err) {
    console.log(err);
  }
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
      dbValues.push([
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
      ]);
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

      let j = dbValues.length - 1;
      if (!longitude || !latitude) {
        geocodeFns.push(async function() {
          let data = await getGeocodeFetchData(location);
          if (!data.results[0]) {
            console.log(data);
            dbValues[j].push(null);
            dbValues[j].push(null);
          } else {
            dbValues[j].push(data.results[0].geometry.location.lat);
            dbValues[j].push(data.results[0].geometry.location.lng);
          }
          return Promise.resolve(true);
        });
      } else {
        dbValues[j].push(latitude);
        dbValues[j].push(longitude);
      }
    }
  });
  return { dbValues, geocodeFns };
}

async function getGeocodeFetchData(location) {
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
