var express = require('express');
var path = require('path');
var logger = require('morgan');
var fetch = require('node-fetch');
var async = require('async');
const cheerio = require('cheerio');
const rp = require('request-promise');
var htmlToText = require('html-to-text');

var app = express();
var hnFormatted = [];

function hackerNewsFormatTimePosted(timeString) {
  let timeArr = timeString.split(' ');
  let dateNow = new Date();
  let timeNow = dateNow.getTime();
  let postTime = timeNow;

  if (timeArr[1] == 'seconds') {
    postTime -= timeArr[0]*1000;
    timeArr[0] = timeArr[0] + 's';
  }
  else if (timeArr[1] == 'minutes') {
    postTime -= timeArr[0]*60*1000;
    timeArr[0] = timeArr[0] + 'min';
  }
  else if (timeArr[1] == 'hours') {
    postTime -= timeArr[0]*60*60*1000;
    timeArr[0] = timeArr[0] + 'h';
  }
  else if (timeArr[1] == 'days') {
    postTime -= timeArr[0]*24*60*60*1000;
    if (parseInt(timeArr[0]) < 7) {
      timeArr[0] = timeArr[0] + 'd';
    }
    else if (parseInt(timeArr[0]) < 30) {
      timeArr[0] = Math.round(parseInt(timeArr[0])/7.0).toString() + 'w';
    }
    else {
      timeArr[0] = Math.round(parseInt(timeArr[0])/30.4).toString() + 'mon';
    }
  }
  if (timeArr[1] == 'years') {
    postTime -= timeArr[0]*365*24*60*60*1000;
    timeArr[0] = timeArr[0] + 'y';
  }
  timeArr.splice(1,1);

  return {postTimeStr: timeArr.join(' '), postTimeInMs: postTime}
}

const options = {
  uri: 'https://news.ycombinator.com/submitted?id=whoishiring',
  transform: (body) => {return cheerio.load(body);}
};

rp(options)
.then(($) => {
  let whoIsHiringLink;
  $('.storylink').each(function(index, value) {
    let text = $(this).text();
    if (text.includes('Who is hiring?')) {
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
        let postTimeObj = hackerNewsFormatTimePosted(postTime);
        hnFormatted.push(
          {
            source:"hackerNews",
            fullPostText:text,
            descriptionHTML:fullPost,
            readMore: false,
            hidden: false,
            postTimeinMs: postTimeObj.postTimeInMs,
            postTimeStr: postTimeObj.postTimeStr
          }
        );
        if ($($(this).contents()[1]).attr('href')) {
          hnFormatted[hnFormatted.length -1].url = $($(this).contents()[1]).attr('href');
          descriptionText = $($(this).contents().slice(2)).text();
        }
        else {
          descriptionText = $($(this).contents().slice(1)).text();
        }
        hnFormatted[hnFormatted.length -1].companyName = listingInfo.shift();
        hnFormatted[hnFormatted.length -1].descriptionText = descriptionText;
        while (i < listingInfo.length) {
          if (listingInfo[i].includes('http')) {
            hnFormatted[hnFormatted.length -1].url = listingInfo.splice(i, 1);
          }
          else if (/%|salary|€|\$|£|[0-9][0-9]k/.test(listingInfo[i])) {
            hnFormatted[hnFormatted.length -1].compensation = listingInfo.splice(i, 1)[0];
          }
          else if (/position|engineer|developer|senior|junior|scientist|analyst/i.test(listingInfo[i])) {
            hnFormatted[hnFormatted.length -1].title = listingInfo.splice(i, 1)[0];
          }
          else if (/permanent|intern|flexible|remote|on\W*site|part\Wtime|full\Wtime|full/i.test(listingInfo[i])) {
            hnFormatted[hnFormatted.length -1].type = listingInfo.splice(i, 1)[0];
          }
          else if (/boston|seattle|london|new york|san francisco|bay area|nyc|sf/i.test(listingInfo[i])) {
            hnFormatted[hnFormatted.length -1].location = listingInfo.splice(i, 1)[0];
          }
          else if (/\W\W[A-Z][a-zA-Z]/.test(listingInfo[i])) {
            hnFormatted[hnFormatted.length -1].location = listingInfo.splice(i, 1)[0];
          }
          else if (/[a-z]\.[a-z]/i.test(listingInfo[i])) {
            hnFormatted[hnFormatted.length -1].url = "http://" + listingInfo.splice(i, 1)[0];
          }
          else if (listingInfo[i] === " ") {
            listingInfo.splice(i, 1);
          }
          else {
            i++;
          }
        }
        let indexHnFormatted = hnFormatted.length -1;
        if (hnFormatted[hnFormatted.length -1].location) {
          let location = hnFormatted[indexHnFormatted].location.replace(/[^a-zA-Z0-9-_]/g, ' ')
        }
        else {
          hnFormatted[indexHnFormatted].distance = false;
        }
        // if (listingInfo.length > 0) {
        //   console.log(listingInfo);
        // }
      }
    });
    console.log('yay');
  })
  .catch((err) => {
    console.log(err);
  });
})
.catch((err) => {
  console.log(err);
});
