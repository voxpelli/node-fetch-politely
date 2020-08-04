// @ts-check
/// <reference types="node" />

'use strict';

const request = require('request');
const robots = require('robots');
const { URL } = require('url');

const quickCache = function (options) {
  const cache = require('lru-cache')(options);

  return (key, value) => {
    if (!value) {
      return cache.get(key);
    } else {
      cache.set(key, value);
    }
  };
};

class PoliteRobot {
  /**
   * @param {Object} options
   * @param {function} options.log
   * @param {string} options.userAgent
   * @param {Object} [options.cache]
   * @param {number} [options.cacheLimit]
   * @param {Object} [options.pool] A pool for requests
   */
  constructor (options) {
    if (!options.cache) {
      options.cache = quickCache({
        max: options.cacheLimit || 500,
        maxAge: 1000 * 60 * 60 * 24
      });
    }

    if (!options.userAgent) throw new TypeError('Robots.txt lookups needs a user-agent to match against');

    this._request = request.defaults({
      timeout: 8000,
      pool: options.pool || false,
      headers: {
        'user-agent': options.userAgent
      }
    });
    this.options = options;
    this.log = options.log;
  }

  _cache (key, value) {
    return this.options.cache(key, value);
  }

  _fetch (url) {
    const robotUrl = (new URL('/robots.txt', url)).toString();
    const robotContent = this._cache(robotUrl);

    if (robotContent !== undefined) {
      this.log('Found cache for', robotUrl);
      return robotContent;
    }

    this.log('Fetching', robotUrl);

    const result = new Promise((resolve, reject) => {
      this._request(robotUrl, (err, res, result) => {
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
  }

  allowed (url) {
    const parsedUrl = new URL(url);

    return this._fetch(url).then(robotContent => {
      if (robotContent === false) {
        return false;
      } else if (robotContent === true) {
        return true;
      } else {
        // @ts-ignore See https://github.com/ekalinin/robots.js/pull/31
        const parser = new robots.RobotsParser();
        parser.parse(robotContent.split(/\r\n|\r|\n/));
        return parser.canFetchSync(this.options.userAgent, parsedUrl.pathname);
        // TODO: Make use of crawldelay as well!
      }
    }).then(access => {
      this.log('We', access ? 'are' : 'are NOT', 'allowed to fetch', parsedUrl.hostname + '' + parsedUrl.pathname);
      return access;
    });
  }
}

module.exports = PoliteRobot;
