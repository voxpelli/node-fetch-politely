/*jslint node: true */
/* global -Promise */

'use strict';

var _ = require('lodash');
var Promise = require('promise');

var urlModule = require('url');

var PoliteLookup = function (options) {
  this.options = options;
  this.log = options.log;
  this.logger = options.logger;

  this.hosts = {};
  this.queue = [];
};

PoliteLookup.prototype._warnOnFloodedQueue = function () {
  var queueLength = this.queue.length;
  var queueLengthByHostnames = {};
  var floodedHostnames = {};

  if (queueLength % 500 === 0) {
    this.logger.warn('Queue length has reached ' + queueLength + ' items');

    _.map(this.queue, function (item) {
      queueLengthByHostnames[item.hostname] = (queueLengthByHostnames[item.hostname] || 0) + 1;
    });

    _.forEach(queueLengthByHostnames, function (count, hostname) {
      if (count > 250) {
        floodedHostnames[hostname] = count;
      }
    });

    if (!_.isEmpty(floodedHostnames)) {
      this.logger.warn('Flooded hostnames', floodedHostnames);
    }
  }
};

PoliteLookup.prototype._purgeUnthrottledHosts = function () {
  this.hosts = _.omit(this.hosts, function (lastFetched, host) {
    if (Date.now() - lastFetched > this.options.throttleDuration) {
      this.log('Purged host throttle:', host);
    }
    return Date.now() - lastFetched > this.options.throttleDuration;
  }, this);
};

PoliteLookup.prototype._reserveSlot = function (hostname) {
  if (!this.hosts[hostname]) {
    this.hosts[hostname] = Date.now();
    return true;
  }

  return this.hosts[hostname] + this.options.throttleDuration;
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
  var nextRelease;
  var that = this;

  this._nextRelease = undefined;
  this._releaseTimer = undefined;

  this.log('Trying to release items');

  this._purgeUnthrottledHosts();

  this.queue = _.reject(this.queue, function (item) {
    var reserved = this._reserveSlot(item.hostname);

    if (reserved === true) {
      this.log('Releasing', item.url);
      that.releaseCallback(null, item.url, item.message);
      return true;
    } else {
      this.log('Keeping', item.url);
      nextRelease = nextRelease === undefined ? reserved : Math.min(reserved, nextRelease);
    }
  }, this);

  if (nextRelease !== undefined) {
    this._scheduleReleaseListener(nextRelease);
  }
};

PoliteLookup.prototype.releasedFromQueue = function (callback) {
  this.releaseCallback = callback;
};

PoliteLookup.prototype.queueForLater = function (url, message, options) {
  if (!this.releaseCallback) {
    return Promise.reject(new Error('Need a release callback'));
  }

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
    message: _.isObject(message) ? JSON.parse(JSON.stringify(message)) : message,
  };

  this.queue.push(item);

  this._warnOnFloodedQueue();

  this._scheduleReleaseListener(item.added + this.options.throttleDuration);

  return Promise.resolve();
};

PoliteLookup.prototype.reserveSlot = function (url) {
  this._purgeUnthrottledHosts();

  var reserved = this._reserveSlot(urlModule.parse(url).hostname);

  return Promise.resolve(reserved === true ? true : false);
};

module.exports = PoliteLookup;
