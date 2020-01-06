#!/usr/bin/env node
var express = require('express');
var app = express();
var server = require('http').Server(app);
var _ = require('lodash');
var moment = require('moment');
var bodyParser = require('body-parser');
var Promise = require('bluebird');
var debug = require('debug')('amtrex');
var nconf = require('nconf');
var cors = require('cors');

var dbutils = require('../lib/dbutils');
var APIs = require('../lib/api');
var security = require('../lib/security');

var cfgFile = "config/settings.json";
var redOn = "\033[31m";
var redOff = "\033[0m";

nconf.argv().env().file({ file: cfgFile });

console.log(redOn + "ઉ nconf loaded, using " + cfgFile + redOff);

if(!nconf.get('interface') || !nconf.get('port') )
    throw new Error("check your config/settings.json, config of 'interface' and 'post' missing");

var returnHTTPError = function(req, res, funcName, where) {
    debug("%s HTTP error 500 %s [%s]", req.randomUnicode, funcName, where);
    res.status(500);
    res.send();
    return false;
};


/* This function wraps all the API call, checking the verionNumber
 * managing error in 4XX/5XX messages and making all these asyncronous
 * I/O with DB, inside this Bluebird */
function dispatchPromise(name, req, res) {

    var apiV = _.parseInt(_.get(req.params, 'version'));

    /* force version to the only supported version */
    debug("%s name %s (%s)", moment().format("HH:mm:ss"), name, req.url);

    var func = _.get(APIs.implementations, name, null);

    if(_.isNull(func)) {
        debug("Invalid function request");
        return returnHTTPError(req, res, name, "function not found?");
    }

    /* in theory here we can keep track of time */
    return new Promise.resolve(func(req))
      .then(function(httpresult) {

          if(_.isObject(httpresult.headers))
              _.each(httpresult.headers, function(value, key) {
                  debug("Setting header %s: %s", key, value);
                  res.setHeader(key, value);
              });
          if(httpresult.json) {
              debug("%s API success, returning JSON (%d bytes)",
                  name, _.size(JSON.stringify(httpresult.json)) );
                  
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.json(httpresult.json)
          } else if(httpresult.text) {
              debug("API %s success, returning text (size %d)",
                  name, _.size(httpresult.text));
              res.send(httpresult.text)
          } else {
              debug("Undetermined failure in API call, result →  %j", httpresult);
              return returnHTTPError(req, res, name, "Undetermined failure");
          }
          return true;
      })
      .catch(function(error) {
          debug("%s Trigger an Exception %s: %s",
              req.randomUnicode, name, error);
          return returnHTTPError(req, res, name, "Exception");
      });
};

/* everything begin here, welcome */
server.listen(nconf.get('port'), nconf.get('interface'));
console.log(" Listening on http://" + nconf.get('interface') + ":" + nconf.get('port'));
/* configuration of express4 */
app.use(cors());
app.use(bodyParser.json({limit: '8mb'}));
app.use(bodyParser.urlencoded({limit: '8mb', extended: true}));

app.get('/api/v1/last', function(req, res) {
    return dispatchPromise('getLast', req, res);
});
app.get('/api/v1/videoId/:query', function(req, res) {
    return dispatchPromise('getVideoId', req, res);
});
app.get('/api/v1/related/:query', function(req, res) {
    return dispatchPromise('getRelated', req, res);
});
app.get('/api/v1/videoCSV/:query/:amount?', function(req, res) {
    return dispatchPromise('getVideoCSV', req, res);
});
app.get('/api/v1/searchcsv', function(req, res) {
    return dispatchPromise('getSearchCSV', req, res);
});
app.get('/api/v1/author/:query/:amount?', function(req, res) {
    return dispatchPromise('getByAuthor', req, res);
});
app.get('/api/v1/views/:ids', function(req, res) {
    return dispatchPromise('getView', req, res);
})

/* This is import and validate the key */
app.post('/api/v:version/validate', function(req, res) {
    return dispatchPromise('validateKey', req, res);
});
/* This to actually post the event collection */
app.post('/api/v2/events', function(req, res) {
    return dispatchPromise('processEvents2', req, res);
});

/* download your full CSV */
app.get('/api/v1/personal/:publicKey/csv', function(req, res) {
    return dispatchPromise('getPersonalCSV', req, res);
});
/* API for researcher: get your related as single list */
app.get('/api/v1/personal/:publicKey/related/:paging?', function(req, res) {
    return dispatchPromise('getPersonalRelated', req, res);
});

/* this return a summary (profile, total amount of videos, last videos */
app.get('/api/v1/personal/:publicKey/:paging?', function(req, res) {
    return dispatchPromise('getPersonal', req, res);
});

/* action on specific evidence */
app.delete('/api/v2/personal/:publicKey/selector/id/:id', (req, res) => {
    return dispatchPromise('removeEvidence', req, res);
});
app.get('/api/v2/personal/:publicKey/selector/:key/:value', (req, res) => {
    return dispatchPromise('getEvidences', req, res);
});

/* to be check if still relevant */
app.get('/api/v1/html/:htmlId', function(req, res) {
    return dispatchPromise('unitById', req, res);
});

/* research subscription and I/O */
app.get('/api/v1/research/:publicKey', function(req, res) {
    return dispatchPromise('rsync', req, res);
});

/* admin */
app.get('/api/v1/mirror/:key', function(req, res) {
    return dispatchPromise('getMirror', req, res);
});

/* impact --- the only one in version 2 already */
app.get('/api/v2/statistics/:name/:unit/:amount', function(req, res) {
    return dispatchPromise('getStatistics', req, res);
});

/* delete a group from your profile, create a new tagId */
app.delete('/api/v2/profile/:publicKey/tag/:tagId', (req, res) => {
    return dispatchPromise('removeTag', req, res);
});
app.post('/api/v2/profile/:publicKey/tag', (req, res) => {
    return dispatchPromise("createTag", req, res);
});

/* update and current profile */
app.get('/api/v2/profile/:publicKey/tag', (req, res) => {
    return dispatchPromise('profileStatus', req, res);
});
app.post('/api/v2/profile/:publicKey', (req, res) => {
    return dispatchPromise("updateProfile", req, res);
});


/* monitor for admin */
app.get('/api/v2/monitor/:minutes?', function(req, res) {
    return dispatchPromise('getMonitor', req, res);
});

/* the remaining code */
security.checkKeyIsSet();

Promise.resolve().then(function() {
    if(dbutils.checkMongoWorks()) {
        debug("mongodb connection works");
    } else {
        console.log("mongodb is not running - check", cfgFile,"- quitting");
        process.exit(1);
    }
});

