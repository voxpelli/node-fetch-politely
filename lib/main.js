// @ts-check
/// <reference types="node" />

'use strict';

const assert = require('assert');

const noop = function () {};

const bunyanAdaptor = require('bunyan-adaptor')({
  verbose: noop
});

const PoliteError = require('./error');

/**
 * @typedef {function(string): Promise<boolean>} allowedCallback
 */

/**
 * @typedef {object} FetchPolitelyStructure
 * @property {object} PoliteLookup
 */

class FetchPolitely {
  /**
   * Creates a FetchPolitely instance.
   * @param {function(Error|null, string, string|Object<string,any>, [string]): void} callback
   * @param {Object} options
   * @param {string} options.userAgent
   * @param {false|allowedCallback} [options.allowed]
   * @param {Object} [options.logger]
   * @param {Object} [options.lookup]
   * @param {Object} [options.lookupOptions]
   * @param {boolean} [options.returnContent]
   * @param {Object} [options.robotCache]
   * @param {number} [options.robotCacheLimit]
   * @param {Object} [options.robotPool]
   * @param {number} [options.throttleDuration]
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

    assert(callback, 'No callback defined for succesful slot requests');

    this.log = options.logger.debug.bind(options.logger);

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
      const LookupConstructor = options.lookup || FetchPolitely.PoliteLookup;
      options.lookup = new LookupConstructor(Object.assign({
        throttleDuration: options.throttleDuration,
        log: this.log,
        logger: options.logger
      }, options.lookupOptions || {}));
    }

    if (options.allowed === false) {
      this._allowedCallback = () => Promise.resolve(true);
    } else if (!options.allowed) {
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
          callback.call(this, err, url, message);
        });
      }
    };

    options.lookup.releasedFromQueue(this.callback.bind(this));
  }

  /**
   * @param {string} url
   * @param {string|Object<string,any>} [message]
   * @param {Object} [options]
   * @param {boolean} [options.allow]
   * @param {boolean} [options.allowDuplicates]
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
    // if (this.options.lookup.close) { this.options.lookup.close(); }
    // if (this._allowedCallback.close) { this._allowedCallback.close(); }
  }

  _allowed (url) {
    return this._allowedCallback(url);
  }

  _reserveSlot () {
    return this.options.lookup.reserveSlot.apply(this.options.lookup, arguments);
  }

  _queueForLater () {
    return this.options.lookup.queueForLater.apply(this.options.lookup, arguments);
  }
}

FetchPolitely.PoliteError = PoliteError;
FetchPolitely.PoliteLookup = require('./lookup');
FetchPolitely.PolitePGLookup = require('./pglookup');
FetchPolitely.PoliteRobot = require('./robot');

module.exports = FetchPolitely;
