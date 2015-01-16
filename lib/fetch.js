/*jslint node: true */
/* global -Promise */

'use strict';

var _ = require('lodash');
var Promise = require('promise');

var assert = require('assert');

var PoliteError = require('./error');
var PoliteLookup = require('./lookup');
var PoliteRobot = require('./robot');

var FetchPolitely = function (callback, options) {
  var robot;

  options = _.extend({
    throttleDuration: 10 * 1000, // 10 seconds
    returnContent: false,
    log: console.log.bind(console),
  }, options);

  assert(callback, 'No callback defined for succesful slot requests');

  if (options.returnContent) {
    assert(options.userAgent, 'You need to define a user-agent');

    this._request = require('request').defaults({
      headers: {
        'user-agent': options.userAgent
      },
    });
  }

  if (!options.lookup) {
    options.lookup = new PoliteLookup({
      throttleDuration: options.throttleDuration,
      log: options.log,
    });
  }

  if (!options.allowed) {
    robot = new PoliteRobot({
      cache : options.robotCache,
      userAgent : options.userAgent,
      log: options.log,
    });
    options.allowed = robot.allowed.bind(robot);
  }

  this.options = options;
  this.log = options.log;
  this.callback = function (err, url, message) {
    var that = this;

    if (options.returnContent && !err) {
      this._request(url, function (err, res, result) {
        if (!err && res.statusCode > 299) {
          err = new PoliteError('Unsuccessful fetch', 'statuscode');
          err.res = res;
        }

        if (err) {
          result = undefined;
        }

        callback.call(that, err, url, message, result);
      });
    } else {
      setImmediate(function () {
        callback.call(that, err, url, message);
      });
    }
  };

  //TODO: Add an option for fetching file content before sending it to callback – we will have the dependencies for that installed anyway due to Robots.txt

  options.lookup.releasedFromQueue(this.callback.bind(this));
};

FetchPolitely.prototype.requestSlot = function (url, message, options) {
  var that = this;
  var result;

  options = options || {};

  result = options.allow === true ? Promise.resolve(true) : this._allowed(url);

  result
    .then(function (allowed) {
      var err;

      if (!allowed) {
        err = new PoliteError('Not allowed to fetch that resource', 'unallowed');
        that.callback(err, url, message);
        return;
      }

      return that._reserveSlot(url).then(function (reserved) {
        if (reserved) {
          that.callback(null, url, message);
        } else {
          that._queueForLater(url, message, {
            allowDuplicates: options.allowDuplicates
          });
        }
      });
    })
    .catch(function (err) {
      that.callback(err, url, message);
    });
};

FetchPolitely.prototype._allowed = function (url) {
  return this.options.allowed(url);
};

FetchPolitely.prototype._reserveSlot = function () {
  return this.options.lookup.reserveSlot.apply(this.options.lookup, arguments);
};

FetchPolitely.prototype._queueForLater = function () {
  return this.options.lookup.queueForLater.apply(this.options.lookup, arguments);
};

FetchPolitely.PoliteError = PoliteError;
FetchPolitely.PoliteLookup = PoliteLookup;
FetchPolitely.PoliteRobot = PoliteRobot;

module.exports = FetchPolitely;
