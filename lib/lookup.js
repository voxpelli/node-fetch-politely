'use strict';

var _ = require('lodash');

var urlModule = require('url');

var PoliteLookup = function (options) {
  this.options = options;
  this.log = options.log;
  this.logger = options.logger;

  this.hosts = {};
  this.queue = [];

  this.throttleDurationHost = this.options.throttleDurationHost || function () {
    return Promise.resolve();
  };
  this.sinceLastFloodCheck = 0;
};

PoliteLookup.prototype._warnOnFloodedQueue = function () {
  this.sinceLastFloodCheck += 1;

  if (this.sinceLastFloodCheck < (this.options.floodLimitCheckEvery || 250)) {
    return;
  }

  this.sinceLastFloodCheck = 0;

  var queueLength = this.queue.length;
  var queueLengthByHostnames = {};
  var floodedHostnames = {};
  var floodLimit = this.options.floodLimit || 250;
  var floodLimitHostname = this.options.floodLimitHostname || 25;

  if (queueLength > floodLimit) {
    this.logger.warn('Queue length has reached ' + queueLength + ' items');

    _.map(this.queue, function (item) {
      queueLengthByHostnames[item.hostname] = (queueLengthByHostnames[item.hostname] || 0) + 1;
    });

    _.forEach(queueLengthByHostnames, function (count, hostname) {
      if (count > floodLimitHostname) {
        floodedHostnames[hostname] = count;
      }
    });

    if (!_.isEmpty(floodedHostnames)) {
      this.logger.warn('Flooded hostnames', floodedHostnames);
    }
  }
};

PoliteLookup.prototype._purgeUnthrottledHosts = function () {
  this.hosts = _.omit(this.hosts, function (releaseTime, host) {
    var release = _.isNumber(releaseTime) && releaseTime < Date.now();
    if (release) { this.log('Purged host throttle:', host); }
    return release;
  }, this);
};

PoliteLookup.prototype._reserveSlot = function (hostname) {
  var that = this;

  if (!this.hosts[hostname]) {
    this.hosts[hostname] = this.throttleDurationHost(hostname).then(function (throttleDuration) {
      that.hosts[hostname] = Date.now() + (throttleDuration || that.options.throttleDuration);
      return that.hosts[hostname];
    });

    this.hosts[hostname].catch(function (err) {
      process.nextTick(function () { throw err; });
    });

    return this.hosts[hostname].then(function () {
      return true;
    });
  }

  return Promise.resolve(this.hosts[hostname]);
};

PoliteLookup.prototype._scheduleReleaseListener = function (nextRelease) {
  var delay;

  if (!this._nextRelease || this._nextRelease > nextRelease) {
    this._nextRelease = nextRelease;
    delay = this._nextRelease - Date.now();

    this.log('Scheduling release in', delay, 'microseconds');

    if (this._releaseTimer) {
      clearTimeout(this._releaseTimer);
    }
    this._releaseTimer = setTimeout(this._checkReleased.bind(this), delay);
  }
};

PoliteLookup.prototype._checkReleased = function () {
  if (this._releasedChecking) {
    return;
  }

  var nextRelease;
  var that = this;

  this._nextRelease = undefined;
  this._releaseTimer = undefined;

  this.log('Trying to release items');

  this._purgeUnthrottledHosts();

  this._releasedChecking = Promise.all(_.map(this.queue, function (item) {
    return that._reserveSlot(item.hostname).then(function (reserved) {
      if (reserved === true) {
        that.log('Releasing', item.url);
        _.pull(that.queue, item);
        that.releaseCallback(null, item.url, item.message);
      } else {
        that.log('Keeping', item.url);
        nextRelease = nextRelease === undefined ? reserved : Math.min(reserved, nextRelease);
      }
    });
  })).then(function () {
    if (nextRelease !== undefined) {
      that._scheduleReleaseListener(nextRelease);
    }

    that._releasedChecking = undefined;
  });

  this._releasedChecking.catch(function (err) {
    process.nextTick(function () { throw err; });
  });
};

PoliteLookup.prototype.releasedFromQueue = function (callback) {
  this.releaseCallback = callback;
};

PoliteLookup.prototype.queueForLater = function (url, message, options) {
  if (!this.releaseCallback) {
    return Promise.reject(new Error('Need a release callback'));
  }

  var that = this;

  options = options || {};

  if (
    options.allowDuplicates === false &&
    _.find(this.queue, function (item) {
      return item.url === url && _.isEqual(item.message, message);
    })
  ) {
    this.log('Already queued, skipping:', url);
    return Promise.resolve();
  }

  var item = {
    added: Date.now(),
    url: url,
    hostname: urlModule.parse(url).hostname,
    // Most plugins will have to serialize the data, so the default object should do so as well
    // (I know – it's ugly ugly...)
    message: _.isObject(message) ? JSON.parse(JSON.stringify(message)) : message
  };

  this.queue.push(item);

  this._warnOnFloodedQueue();

  Promise.resolve(this.hosts[item.hostname]).then(function (released) {
    that._scheduleReleaseListener(released || 1);
  });

  return Promise.resolve();
};

PoliteLookup.prototype.reserveSlot = function (url) {
  this._purgeUnthrottledHosts();

  return this._reserveSlot(urlModule.parse(url).hostname).then(function (reserved) {
    return reserved === true;
  });
};

module.exports = PoliteLookup;
