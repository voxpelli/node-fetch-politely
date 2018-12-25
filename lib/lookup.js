// @ts-check
/// <reference types="node" />

'use strict';

const { URL } = require('url');

const isEqual = require('lodash.isequal');
const pull = require('lodash.pull');

class PoliteLookup {
  /**
   * @param {Object} options
   * @param {function} options.log
   * @param {Object} options.logger
   * @param {number} [options.floodLimit]
   * @param {number} [options.floodLimitCheckEvery]
   * @param {number} [options.floodLimitHostname]
   * @param {number} [options.throttleDuration]
   * @param {function(string): Promise<number|void>} [options.throttleDurationHost]
   */
  constructor (options) {
    this.options = options;
    this.log = options.log;
    this.logger = options.logger;

    this.hosts = {};
    this.queue = [];

    this.throttleDurationHost = this.options.throttleDurationHost || (() => Promise.resolve());
    this.sinceLastFloodCheck = 0;
  }

  _warnOnFloodedQueue () {
    this.sinceLastFloodCheck += 1;

    if (this.sinceLastFloodCheck < (this.options.floodLimitCheckEvery || 250)) {
      return;
    }

    this.sinceLastFloodCheck = 0;

    const queueLength = this.queue.length;
    const queueLengthByHostnames = {};
    const floodedHostnames = {};
    const floodLimit = this.options.floodLimit || 250;
    const floodLimitHostname = this.options.floodLimitHostname || 25;

    if (queueLength > floodLimit) {
      this.logger.warn('Queue length has reached ' + queueLength + ' items');

      this.queue.forEach(item => {
        queueLengthByHostnames[item.hostname] = (queueLengthByHostnames[item.hostname] || 0) + 1;
      });

      Object.keys(queueLengthByHostnames).forEach(hostname => {
        const count = queueLengthByHostnames[hostname];
        if (count > floodLimitHostname) {
          floodedHostnames[hostname] = count;
        }
      });

      if (Object.keys(floodedHostnames).length !== 0) {
        this.logger.warn('Flooded hostnames', floodedHostnames);
      }
    }
  }

  _purgeUnthrottledHosts () {
    const hosts = {};

    Object.keys(this.hosts).forEach(host => {
      const releaseTime = this.hosts[host];
      if (typeof releaseTime === 'number' && releaseTime < Date.now()) {
        this.log('Purged host throttle:', host);
      } else {
        hosts[host] = releaseTime;
      }
    });

    this.hosts = hosts;
  }

  _reserveSlot (hostname) {
    if (!this.hosts[hostname]) {
      this.hosts[hostname] = this.throttleDurationHost(hostname).then(throttleDuration => {
        this.hosts[hostname] = Date.now() + (throttleDuration || this.options.throttleDuration);
        return this.hosts[hostname];
      });

      this.hosts[hostname].catch(err => {
        process.nextTick(() => { throw err; });
      });

      return this.hosts[hostname].then(() => true);
    }

    return Promise.resolve(this.hosts[hostname]);
  }

  _scheduleReleaseListener (nextRelease) {
    if (!this._nextRelease || this._nextRelease > nextRelease) {
      this._nextRelease = nextRelease;
      const delay = this._nextRelease - Date.now();

      this.log('Scheduling release in', delay, 'microseconds');

      if (this._releaseTimer) {
        clearTimeout(this._releaseTimer);
      }
      this._releaseTimer = setTimeout(() => { this._checkReleased(); }, delay);
    }
  }

  _checkReleased () {
    if (this._releasedChecking) {
      return;
    }

    let nextRelease;

    this._nextRelease = undefined;
    this._releaseTimer = undefined;

    this.log('Trying to release items');

    this._purgeUnthrottledHosts();

    this._releasedChecking = Promise.all(this.queue.map(item => {
      return this._reserveSlot(item.hostname).then(reserved => {
        if (reserved === true) {
          this.log('Releasing', item.url);
          pull(this.queue, item);
          this.releaseCallback(null, item.url, item.message);
        } else {
          this.log('Keeping', item.url);
          nextRelease = nextRelease === undefined ? reserved : Math.min(reserved, nextRelease);
        }
      });
    })).then(() => {
      if (nextRelease !== undefined) {
        this._scheduleReleaseListener(nextRelease);
      }

      this._releasedChecking = undefined;
    });

    this._releasedChecking.catch(err => {
      process.nextTick(() => { throw err; });
    });
  }

  /**
   * @param {function(Error|null, string, string|Object<string,any>): void} callback
   * @returns {void}
   */
  releasedFromQueue (callback) {
    this.releaseCallback = callback;
  }

  /**
   * @param {string} url
   * @param {string|Object<string,any>} message
   * @param {Object} options
   * @param {boolean} [options.allowDuplicates]
   * @returns {Promise<void>}
   */
  queueForLater (url, message, options = {}) {
    if (!this.releaseCallback) {
      return Promise.reject(new Error('Need a release callback'));
    }

    if (
      options.allowDuplicates === false &&
      this.queue.some(item => item.url === url && isEqual(item.message, message))
    ) {
      this.log('Already queued, skipping:', url);
      return Promise.resolve();
    }

    const item = {
      added: Date.now(),
      url,
      hostname: (new URL(url)).hostname,
      // Most plugins will have to serialize the data, so the default object should do so as well
      // (I know – it's ugly ugly...)
      message: typeof message === 'object' ? JSON.parse(JSON.stringify(message)) : message
    };

    this.queue.push(item);

    this._warnOnFloodedQueue();

    Promise.resolve(this.hosts[item.hostname]).then(released => {
      this._scheduleReleaseListener(released || 1);
    });

    return Promise.resolve();
  }

  /**
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  reserveSlot (url) {
    this._purgeUnthrottledHosts();

    return this._reserveSlot((new URL(url)).hostname)
      .then(reserved => reserved === true);
  }
}

module.exports = PoliteLookup;
