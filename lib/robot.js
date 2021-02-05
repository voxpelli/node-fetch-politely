'use strict';

var assert = require('assert');
var request = require('request');
var robots = require('robots');
var urlModule = require('url');

var quickCache = function (options) {
  var cache = require('lru-cache')(options);

  return function (key, value) {
    if (!value) {
      return cache.get(key);
    } else {
      cache.set(key, value);
    }
  };
};

var PoliteRobot = function (options) {
  if (!options.cache) {
    options.cache = quickCache({
      max: options.cacheLimit || 500,
      maxAge: 1000 * 60 * 60 * 24
    });
  }

  assert(options.userAgent, 'Robots.txt lookups needs a user-agent to match against');

  this._request = request.defaults({
    timeout: 8000,
    pool: options.pool || false,
    headers: {
      'user-agent': options.userAgent
    }
  });
  this.options = options;
  this.log = options.log;
};

PoliteRobot.prototype._cache = function (key, value) {
  return this.options.cache(key, value);
};

PoliteRobot.prototype._fetch = function (url) {
  var that = this;
  var robotUrl;
  var result;

  try {
    robotUrl = urlModule.resolve(url, '/robots.txt');
  }
  catch (err) {
    console.error("Error resolving " + url + "/robots.txt:", err);
    return Promise.resolve(true);
  }

  var robotContent = this._cache(robotUrl);

  if (robotContent !== undefined) {
    this.log('Found cache for', robotUrl);
    return robotContent;
  }

  this.log('Fetching', robotUrl);

  result = new Promise(function (resolve, reject) {
    that._request(robotUrl, function (err, res, result) {
      if (err) {
        return reject(err);
      }
      if ([401, 403].indexOf(res.statusCode) !== -1) {
        // Everything is forbidden
        result = false;
      } else if (res.statusCode > 399) {
        // Everything is allowed
        result = true;
      }
      resolve(result);
    });
  });

  // Make all requests for the same Robots file use the same Promise!
  this._cache(robotUrl, result);

  return result;
};

PoliteRobot.prototype.allowed = function (url) {
  var that = this;
  return this._fetch(url).then(function (robotContent) {
    if (robotContent === false) {
      return false;
    } else if (robotContent === true) {
      return true;
    } else {
      var parser = new robots.RobotsParser();
      parser.parse(robotContent.split(/\r\n|\r|\n/));
      return parser.canFetchSync(that.options.userAgent, urlModule.parse(url).pathname);
      // TODO: Make use of crawldelay as well!
    }
  }).then(function (access) {
    that.log('We', access ? 'are' : 'are NOT', 'allowed to fetch', urlModule.parse(url).hostname + '' + urlModule.parse(url).pathname);
    return access;
  }).catch(function (err) {
    // RC: Catch errors from request because of bad SSL cert, for instance. This
    //     may only happen when calling allowed() directly as udu happens to do.
    return true;
  });
};

module.exports = PoliteRobot;
