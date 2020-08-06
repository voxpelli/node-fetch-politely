// @ts-check
/// <reference types="node" />

'use strict';

const noop = function () {};

const bunyanAdaptor = require('bunyan-adaptor')({
  verbose: noop
});

const PoliteError = require('./error');

/**
 * @typedef {(url: string) => Promise<boolean>} allowedCallback
 */

/**
 * @typedef {object} FetchPolitelyStructure
 * @property {object} PoliteLookup
 */

/**
 * @typedef FetchPolitelyOptions
 * @property {string} userAgent
 * @property {boolean|allowedCallback} [allowed]
 * @property {import('bunyan-adaptor').BunyanLite} [logger]
 * @property {import('./lookup')|(typeof import('./lookup'))} [lookup]
 * @property {Object} [lookupOptions]
 * @property {boolean} [returnContent]
 * @property {import('./robot').SingleMethodCache} [robotCache]
 * @property {number} [robotCacheLimit]
 * @property {Object} [robotPool]
 * @property {number} [throttleDuration]
 */

class FetchPolitely {
  /**
   * Creates a FetchPolitely instance.
   *
   * @param {(err: Error|null, url: string, message?: string|import('type-fest').JsonValue, content?: string) => void} callback
   * @param {FetchPolitelyOptions} options
   */
  constructor (callback, options) {
    options = Object.assign({
      throttleDuration: 10 * 1000, // 10 seconds
      returnContent: false,
      logger: bunyanAdaptor,
      lookup: undefined,
      lookupOptions: undefined,
      allowed: undefined
    }, options);

    if (!callback) throw new TypeError('No callback defined for successful slot requests.');

    this.log = options.logger.debug.bind(options.logger);

    if (options.returnContent) {
      if (!options.userAgent) throw new Error('You need to define a user-agent');

      this._request = require('request').defaults({
        pool: { maxSockets: Infinity },
        headers: {
          'user-agent': options.userAgent
        }
      });
    }

    if (!options.lookup || typeof options.lookup === 'function') {
      const LookupConstructor = options.lookup || FetchPolitely.PoliteLookup;
      this.lookup = new LookupConstructor(Object.assign({
        throttleDuration: options.throttleDuration,
        log: this.log,
        logger: options.logger
      }, options.lookupOptions || {}));
    } else {
      this.lookup = options.lookup;
    }

    if (options.allowed === false) {
      this._allowedCallback = () => Promise.resolve(true);
    } else if (!options.allowed || options.allowed === true) {
      const robot = new FetchPolitely.PoliteRobot({
        cache: options.robotCache,
        cacheLimit: options.robotCacheLimit,
        pool: options.robotPool,
        userAgent: options.userAgent,
        log: this.log
      });
      this._allowedCallback = robot.allowed.bind(robot);
    } else {
      /** @type {allowedCallback} */
      this._allowedCallback = options.allowed;
    }

    this.options = options;
    this.logger = options.logger;

    /**
     * @param {Error|null} err
     * @param {string} url
     * @param {import('type-fest').JsonValue} [message]
     */
    this.callback = (err, url, message) => {
      if (options.returnContent && !err) {
        this._request(url, (err, res, result) => {
          if (!err && res.statusCode > 299) {
            err = new PoliteError('Unsuccessful fetch', 'statuscode');
            err.res = res;
          }

          if (err) {
            result = undefined;
          }

          callback.call(this, err, url, message, result);
        });
      } else {
        setImmediate(() => {
          callback.call(this, err, url, message, undefined);
        });
      }
    };

    this.lookup.releasedFromQueue(this.callback.bind(this));
  }

  /**
   * @param {string} url
   * @param {string|import('type-fest').JsonValue} [message]
   * @param {{ allow?: boolean, allowDuplicates?: boolean }} [options]
   * @returns {Promise<void>} Will be resolved or rejected when the request has been made.
   */
  requestSlot (url, message, options = {}) {
    const result = options.allow === true ? Promise.resolve(true) : this._allowed(url);

    return result
      .then(allowed => {
        if (!allowed) {
          const err = new PoliteError('Not allowed to fetch that resource', 'unallowed');
          this.callback(err, url, message);
          return;
        }

        return this._reserveSlot(url).then(reserved => {
          if (reserved) {
            this.callback(null, url, message);
          } else {
            return this._queueForLater(url, message, {
              allowDuplicates: options.allowDuplicates
            });
          }
        });
      })
      .then(() => {
        // We don't want to return anything
      });
  }

  close () {
    // FIXME: Readd this if needed
    // if (this.lookup.close) { this.lookup.close(); }
    // if (this._allowedCallback.close) { this._allowedCallback.close(); }
  }

  /**
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async _allowed (url) {
    return this._allowedCallback(url);
  }

  /**
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async _reserveSlot (url) {
    return this.lookup.reserveSlot(url);
  }

  /**
   * @param {string} url
   * @param {string|import('type-fest').JsonValue} [message]
   * @param {{ allowDuplicates?: boolean }} [options]
   * @returns {Promise<void>}
   */
  async _queueForLater (url, message, options) {
    return this.lookup.queueForLater(url, message, options);
  }
}

FetchPolitely.PoliteError = PoliteError;
FetchPolitely.PoliteLookup = require('./lookup');
FetchPolitely.PolitePGLookup = require('./pglookup');
FetchPolitely.PoliteRobot = require('./robot');

module.exports = FetchPolitely;
