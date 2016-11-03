'use strict';

var _ = require('lodash');

var assert = require('assert');
var bunyanDuckling = require('bunyan-duckling');

var PoliteError = require('./error');

var FetchPolitely = function (callback, options) {
  var robot;
  var LookupConstructor;

  options = _.extend({
    throttleDuration: 10 * 1000, // 10 seconds
    returnContent: false,
    logger: bunyanDuckling,
    lookup: undefined,
    lookupOptions: undefined,
    allowed: undefined
  }, options);

  assert(callback, 'No callback defined for succesful slot requests');

  options.log = options.logger.debug.bind(options.logger);

  if (options.returnContent) {
    assert(options.userAgent, 'You need to define a user-agent');

    this._request = require('request').defaults({
      pool: {maxSockets: Infinity},
      headers: {
        'user-agent': options.userAgent
      }
    });
  }

  if (!options.lookup || !options.lookup.reserveSlot) {
    LookupConstructor = options.lookup || FetchPolitely.PoliteLookup;
    options.lookup = new LookupConstructor(_.extend({
      throttleDuration: options.throttleDuration,
      log: options.log,
      logger: options.logger
    }, options.lookupOptions || {}));
  }

  if (options.allowed === false) {
    options.allowed = function () {
      return Promise.resolve(true);
    };
  } else if (!options.allowed) {
    robot = new FetchPolitely.PoliteRobot({
      cache: options.robotCache,
      cacheLimit: options.robotCacheLimit,
      pool: options.robotPool,
      userAgent: options.userAgent,
      log: options.log
    });
    options.allowed = robot.allowed.bind(robot);
  }

  this.options = options;
  this.log = options.log;
  this.logger = options.logger;
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

  options.lookup.releasedFromQueue(this.callback.bind(this));
};

FetchPolitely.prototype.requestSlot = function (url, message, options) {
  var that = this;
  var result;

  options = options || {};

  result = options.allow === true ? Promise.resolve(true) : this._allowed(url);

  return result
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
          return that._queueForLater(url, message, {
            allowDuplicates: options.allowDuplicates
          });
        }
      });
    })
    .then(function () {
      // We don't want to return anything
      return undefined;
    });
};

FetchPolitely.prototype.close = function () {
  if (this.options.lookup.close) { this.options.lookup.close(); }
  if (this.options.allowed.close) { this.options.allowed.close(); }
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

Object.defineProperties(FetchPolitely, {
  PoliteLookup: {
    get: function () { return require('./lookup'); }
  },
  PolitePGLookup: {
    get: function () { return require('./pglookup'); }
  },
  PoliteRobot: {
    get: function () { return require('./robot'); }
  }
});

module.exports = FetchPolitely;
