// @ts-check
/// <reference types="node" />

'use strict';

const { URL } = require('url');

const isEqual = require('lodash.isequal');
const pull = require('lodash.pull');

/**
 * @typedef PoliteLookupOptions
 * @property {typeof console.log} log
 * @property {import('bunyan-adaptor').BunyanLite} logger
 * @property {number} [floodLimit]
 * @property {number} [floodLimitCheckEvery]
 * @property {number} [floodLimitHostname]
 * @property {number} [throttleDuration]
 * @property {(hostname: string) => Promise<number|void>} [throttleDurationHost]
 */

/**
 * @typedef PoliteLookupItem
 * @property {number} added
 * @property {string} url
 * @property {string} hostname
 * @property {import('type-fest').JsonValue} message
 */

class PoliteLookup {
  /**
   * @param {PoliteLookupOptions} options
   */
  constructor (options) {
    this.options = options;
    this.log = options.log;
    this.logger = options.logger;

    /** @type {{ [hostname: string]: number|Promise<number> }} */
    this.hosts = {};
    /** @type {PoliteLookupItem[]} */
    this.queue = [];

    this.throttleDurationHost = this.options.throttleDurationHost || (async () => {});
    this.sinceLastFloodCheck = 0;
  }

  /** @returns {void} */
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

      // FIXME: Replace forEach with for-loop
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

  /** @returns {void} */
  _purgeUnthrottledHosts () {
    /** @type {{ [hostname: string]: number|Promise<number> }} */
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

  /**
   * @param {string} hostname
   * @returns {Promise<true|number>}
   */
  async _reserveSlot (hostname) {
    if (this.hosts[hostname]) {
      return this.hosts[hostname];
    }

    const throttlePromise = this.throttleDurationHost(hostname).then(throttleDuration => {
      this.hosts[hostname] = Date.now() + (throttleDuration || this.options.throttleDuration);
      return this.hosts[hostname];
    });

    this.hosts[hostname] = throttlePromise;

    throttlePromise.catch(err => {
      process.nextTick(() => { throw err; });
    });

    return throttlePromise.then(() => true);
  }

  /**
   * @param {number} nextRelease
   * @returns {void}
   */
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

  /** @returns {Promise<void>} */
  async _checkReleased () {
    if (this._releasedChecking) {
      return;
    }

    let nextRelease;

    this._nextRelease = undefined;
    this._releaseTimer = undefined;

    this.log('Trying to release items');

    this._purgeUnthrottledHosts();

    this._releasedChecking = Promise.all(this.queue.map(async item => {
      const reserved = await this._reserveSlot(item.hostname);

      if (reserved === true) {
        this.log('Releasing', item.url);
        pull(this.queue, item);
        this.releaseCallback && this.releaseCallback(null, item.url, item.message);
      } else {
        this.log('Keeping', item.url);
        nextRelease = nextRelease === undefined ? reserved : Math.min(reserved, nextRelease);
      }
    }));

    try {
      await this._releasedChecking;
    } catch (err) {
      process.nextTick(() => { throw err; });
    }

    if (nextRelease !== undefined) {
      this._scheduleReleaseListener(nextRelease);
    }

    this._releasedChecking = undefined;
  }

  /**
   * @param {(err: Error|null, url: string, message: string|import('type-fest').JsonValue) => void} callback
   * @returns {void}
   */
  releasedFromQueue (callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected callback to be a function');
    this.releaseCallback = callback;
  }

  /**
   * @param {string} url
   * @param {string|import('type-fest').JsonValue} message
   * @param {{ allowDuplicates?: boolean }} options
   * @returns {Promise<void>}
   */
  async queueForLater (url, message, options = {}) {
    if (!this.releaseCallback) {
      throw new Error('Need a release callback to be set');
    }

    if (
      options.allowDuplicates === false &&
      this.queue.some(item => item.url === url && isEqual(item.message, message))
    ) {
      this.log('Already queued, skipping:', url);
      return;
    }

    /** @type {PoliteLookupItem} */
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

    const released = await this.hosts[item.hostname];

    this._scheduleReleaseListener(released || 1);
  }

  /**
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async reserveSlot (url) {
    this._purgeUnthrottledHosts();

    const reserved = await this._reserveSlot((new URL(url)).hostname);

    return reserved === true;
  }
}

module.exports = PoliteLookup;
