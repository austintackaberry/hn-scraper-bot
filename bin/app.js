#!/usr/bin/env node

var express = require('express');
var path = require('path');
var logger = require('morgan');
var fetch = require('node-fetch');
var async = require('async');
const cheerio = require('cheerio');
const rp = require('request-promise');
var htmlToText = require('html-to-text');
const mysql = require('mysql');

var app = express();
var hnFormatted = [];
var dbValues = [];
var geocodeFns = [];
let asyncHnLocationFnBatches = [];

function hackerNewsFormatTimePosted(timeString) {
  let timeArr = timeString.split(' ');
  let dateNow = new Date();
  let timeNow = dateNow.getTime();
  let postTime = timeNow;

  if (timeArr[1] == 'seconds') {
    postTime -= timeArr[0]*1000;
  }
  else if (timeArr[1] == 'minutes') {
    postTime -= timeArr[0]*60*1000;
  }
  else if (timeArr[1] == 'hours') {
    postTime -= timeArr[0]*60*60*1000;
  }
  else if (timeArr[1] == 'days') {
    postTime -= timeArr[0]*24*60*60*1000;
  }
  if (timeArr[1] == 'years') {
    postTime -= timeArr[0]*365*24*60*60*1000;
  }
  return postTime;
}

var connection = mysql.createConnection({
    host: 'austintackaberry-jobsort.c3tu2houar8w.us-west-1.rds.amazonaws.com',
    user: 'austintackaberry',
    password: process.env.MYSQL_PASSWORD,
    database: 'jobsortdb',
    port: 3306,          //port mysql
    charset: "utf8mb4"
});

function setUpGeocodeFns() {
  let i = 0;
  while (i < geocodeFns.length) {
    let end;
    if (i + 48 > geocodeFns.length) {
      end = geocodeFns.length;
    }
    else {
      end = i + 48;
    }
    let shortGeocodeFns = geocodeFns.slice(i, end);
    i = end;
    asyncHnLocationFnBatches.push(async function() {
      let shortGeocode = await Promise.all(shortGeocodeFns.map(async (fn) => {await fn();}));
      return Promise.resolve(true);
    });
    asyncHnLocationFnBatches.push(async function() {
      return new Promise((resolve, reject) => {
        setTimeout(
          () => {
            resolve(true);
          }, 1000
        );
      });
    });
  }
}

async function runGeocodeFns() {
  for (let fn of asyncHnLocationFnBatches) {
    await fn();
  }
  return Promise.resolve(true);
}

async function clearDatabase() {
  return new Promise((resolve, reject) => {
    const queryStringTruncate = 'TRUNCATE `jobsortdb`.`hackerNewsListings`';
    connection.query(queryStringTruncate, [dbValues], function (error,row) {
      if (!error) {
        resolve(true);
      }
      else {
        reject("TRUNCATE Query Error: " + error);
      }
    });
  })
}

async function insertIntoDatabase() {
  return new Promise((resolve, reject) => {
    const queryStringInsert = "INSERT INTO hackerNewsListings (month, source, fullPostText, descriptionHTML, descriptionText, postTimeInMs, companyName, url, compensation, title, type, location, latitude, longitude) VALUES ?"
    connection.query(queryStringInsert, [dbValues], function (error,row) {
      if (!error) {
        console.log('success!');
        resolve(true);
      }
      else {
        reject("INSERT Query Error: " + error);
      }
    });
  })
}

function getLatestWhoIsHiringLink($) {
  let month;
  let whoIsHiringLink;
  $('.storylink').each(function(index, value) {
    let text = $(this).text();
    if (text.includes('Who is hiring?')) {
      month = text.match(/\(.*\)/)[0];
      whoIsHiringLink = 'https://news.ycombinator.com/' + value.attribs.href;
      return false;
    }
  });
  return {whoIsHiringLink:whoIsHiringLink, month:month};
}

async function callSelectQuery() {
  return new Promise(function(resolve, reject) {
    const queryStringSelect = 'SELECT latitude, longitude, fullPostText FROM jobsortdb.hackerNewsListings';
    connection.query(queryStringSelect, function (error, results, fields) {
      if (!error) {
        resolve(results);
      }
      else {
        reject("SELECT Query Error: " + error)
      }
    });
  });
}


function getDbValues($, results, month) {
  $('.c00').each(function(index, value) {
    let text = $(this).text();
    let topLine = $($(this).contents()[0]).text();
    let listingInfo = topLine.split("|");
    if (listingInfo.length > 1) {
      let i = 0;
      let descriptionHTML;
      let fullPost = $(this);
      fullPost.find('.reply').remove();
      fullPost = fullPost.html();
      let postTime = $(this).parents().eq(2).find('.age').text();
      let postTimeInMs = hackerNewsFormatTimePosted(postTime);
      let source = "hackerNews";
      let fullPostText = text;
      descriptionHTML = fullPost;
      let url, compensation, title, type;
      let location = false;
      if ($($(this).contents()[1]).attr('href')) {
        url = $($(this).contents()[1]).attr('href');
        descriptionText = $($(this).contents().slice(2)).text();
      }
      else {
        descriptionText = $($(this).contents().slice(1)).text();
      }
      let companyName = listingInfo.shift();
      while (i < listingInfo.length) {
        if (listingInfo[i].includes('http')) {
          url = listingInfo.splice(i, 1);
        }
        else if (/%|salary|€|\$|£|[0-9][0-9]k/.test(listingInfo[i])) {
          compensation = listingInfo.splice(i, 1)[0];
        }
        else if (/position|engineer|developer|senior|junior|scientist|analyst/i.test(listingInfo[i]) && listingInfo[i].length < 200) {
          title = listingInfo.splice(i, 1)[0];
        }
        else if (/permanent|intern|flexible|remote|on\W*site|part\Wtime|full\Wtime|full/i.test(listingInfo[i]) && listingInfo[i].length < 200) {
          type = listingInfo.splice(i, 1)[0];
        }
        else if (/boston|seattle|london|new york|san francisco|bay area|nyc|sf/i.test(listingInfo[i]) && listingInfo[i].length < 200) {
          location = listingInfo.splice(i, 1)[0];
        }
        else if (/\W\W[A-Z][a-zA-Z]/.test(listingInfo[i]) && listingInfo[i].length < 200) {
          location = listingInfo.splice(i, 1)[0];
        }
        else if (/[a-z]\.[a-z]/i.test(listingInfo[i]) && listingInfo[i].length < 200) {
          url = "http://" + listingInfo.splice(i, 1)[0];
        }
        else if (listingInfo[i] === " ") {
          listingInfo.splice(i, 1);
        }
        else {
          i++;
        }
      }

      dbValues.push([
        month, source, fullPostText, descriptionHTML, descriptionText, postTimeInMs, companyName, url, compensation, title, type, location
      ]);
      let latitude = false;
      let longitude = false;
      results.some((rowFromDB) => {
        let fullPostTestFromDB = new Buffer(rowFromDB.fullPostText).toString('utf8')
        if (fullPostTestFromDB === fullPostText) {
          latitude = rowFromDB.latitude;
          longitude = rowFromDB.longitude;
          return true;
        }
        return false;
      })

      let j = dbValues.length - 1;
      if (location && latitude !== false) {
        geocodeFns.push(async function(){
          let data = await getGeocodeFetchData(location);
          if (!data.results[0]) {
            console.log(data);
            dbValues[j].push(false);
            dbValues[j].push(false);
          }
          else {
            dbValues[j].push(data.results[0].geometry.location.lat);
            dbValues[j].push(data.results[0].geometry.location.lng);
          }
          return Promise.resolve(true);
        });
      }
      else {
        dbValues[j].push(latitude);
        dbValues[j].push(longitude);
      }
      // console.log(dbValues[j].length);
      // if (listingInfo.length > 0) {
      //   (listingInfo);
      // }
    }
  });
  return true;
}

async function getGeocodeFetchData(location) {
  let locationFormatted = location.replace(/[^a-zA-Z0-9-_]/g, ' ')
  let geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json?address=" + locationFormatted + "&key=AIzaSyAFco2ZmRw5uysFTC4Eck6zXdltYMwb4jk";
  const fetchRes = await fetch(encodeURI(geocodeUrl), {
    method: 'GET'
  });
  const response = await fetchRes.json();
  return response;
}

async function updateDatabase() {
  let options = {
    uri: 'https://news.ycombinator.com/submitted?id=whoishiring',
    transform: (body) => {return cheerio.load(body);}
  };
  let $ = await rp(options);
  const firstPageDetails = getLatestWhoIsHiringLink($);
  options = {
    uri: firstPageDetails.whoIsHiringLink,
    transform: (body) => {return cheerio.load(body);}
  };
  $ = await rp(options);
  const results = await callSelectQuery();
  getDbValues($, results, firstPageDetails.month);
  setUpGeocodeFns();
  await runGeocodeFns();
  await clearDatabase();
  await insertIntoDatabase();
  connection.end();
}

updateDatabase();
