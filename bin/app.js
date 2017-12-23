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
var asyncHnLocationFns = [];

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

const options = {
  uri: 'https://news.ycombinator.com/submitted?id=whoishiring',
  transform: (body) => {return cheerio.load(body);}
};

rp(options)
.then(($) => {
  let whoIsHiringLink;
  let month;
  $('.storylink').each(function(index, value) {
    let text = $(this).text();
    if (text.includes('Who is hiring?')) {
      month = text.match(/\(.*\)/)[0];
      whoIsHiringLink = 'https://news.ycombinator.com/' + value.attribs.href;
      return false;
    }
  });
  const options = {
    uri: whoIsHiringLink,
    transform: (body) => {return cheerio.load(body);}
  };
  rp(options)
  .then(($) => {
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
        let url, compensation, title, type, location;
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
          month, source, fullPostText, descriptionHTML, postTimeInMs, companyName, url, compensation, title, type, location
        ]);
        let j = dbValues.length - 1;
        if (location) {
           asyncHnLocationFns.push(
             (callback) => {
               let locationFormatted = location.replace(/[^a-zA-Z0-9-_]/g, ' ')
               let geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json?address=" + locationFormatted + "&key=AIzaSyAFco2ZmRw5uysFTC4Eck6zXdltYMwb4jk";
               fetch(encodeURI(geocodeUrl), {
                 method: 'GET'
               })
               .then(res => res.json())
               .catch(e => {
                 console.log(e);
               })
               .then(data => {
                 if (!data.results[0]) {
                   console.log(data);
                   dbValues[j].push(false);
                   dbValues[j].push(false);
                 }
                 else {
                   dbValues[j].push(data.results[0].geometry.location.lat);
                   dbValues[j].push(data.results[0].geometry.location.lng);
                 }
                 callback();
               })
               .catch(e => {
                 console.log(e);
               });
             }
           );
         }
         else {
           dbValues[j].push(false);
           dbValues[j].push(false);
         }
        // if (listingInfo.length > 0) {
        //   (listingInfo);
        // }
      }
    });
    let i = 0;
    let asyncHnLocationFnBatches = [];
    while (i < asyncHnLocationFns.length) {
      let end;
      if (i + 48 > asyncHnLocationFns.length) {
        end = asyncHnLocationFns.length;
      }
      else {
        end = i + 48;
      }
      let shortAsyncHnLocationFns = asyncHnLocationFns.slice(i, end);
      i = end;
      asyncHnLocationFnBatches.push(
        (callback) => {
          async.parallel(shortAsyncHnLocationFns, function(err, results) {
            callback();
          });
        }
      );
      asyncHnLocationFnBatches.push(
        (callback) => {
          setTimeout(
            () => {
              callback();
            }, 1000
          );
        }
      );
    }
    async.series(asyncHnLocationFnBatches, function(err, results) {

      let queryString = 'TRUNCATE `jobsortdb`.`hackerNewsListings`';
      connection.query(queryString, [dbValues], function (error,row) {
        if (!error) {
          console.log('table cleared!');
        }
        else {
          console.log("Query Error: "+error);
        }
      });

      queryString = "INSERT INTO hackerNewsListings (month, source, fullPostText, descriptionHTML, postTimeInMs, companyName, url, compensation, title, type, location, latitude, longitude) VALUES ?"
      connection.query(queryString, [dbValues], function (error,row) {
        if (!error) {
          console.log('success!');
        }
        else {
          console.log("Query Error: "+error);
        }
      });
      connection.end();
    });
  })
  .catch((err) => {
    console.log(err);
  });
})
.catch((err) => {
  console.log(err);
});
