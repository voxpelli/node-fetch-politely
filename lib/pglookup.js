// @ts-check
/// <reference types="node" />

'use strict';

const VError = require('verror');

const { URL } = require('url');

const knexQueryBuilder = (knex) => knex.queryBuilder ? knex.queryBuilder() : knex();

class PolitePGLookup {
  /**
   * @param {Object} options
   * @param {function} options.log
   * @param {Object} options.logger
   * @param {Object} options.knex
   * @param {number} [options.concurrentReleases]
   * @param {boolean} [options.onlyDeduplicateMessages]
   * @param {number} [options.purgeWindow]
   * @param {number} [options.releasesPerBatch]
   * @param {number} [options.throttleDuration]
   */
  constructor (options) {
    options = Object.assign({
      throttleDuration: 10 * 1000,
      concurrentReleases: 2,
      releasesPerBatch: 5,
      purgeWindow: 500
    }, options);

    if (!options.knex) throw new TypeError('PolitePGLookup requires the Knex option to work.');

    this.options = options;
    this.log = options.log;
    this.logger = options.logger;
    this.knex = options.knex;
    this.onlyDeduplicateMessages = options.onlyDeduplicateMessages;
    this.concurrentReleases = 0;
  }

  _purgeUnthrottledHosts () {
    if (this.stopped || (this.lastPurge && (Date.now() - this.lastPurge < this.options.purgeWindow))) {
      return Promise.resolve();
    }

    this.logger.debug('Purging expired hosts');
    const knex = this.knex;

    this.lastPurge = Date.now();

    return knex('polite_hosts')
      .where('added', '<', knex.raw('CURRENT_TIMESTAMP - interval \'' + Math.round(this.options.throttleDuration / 1000) + ' seconds\''))
      .delete();
  }

  _checkForReleasables (retry) {
    const knex = this.knex;

    if (!retry) {
      this.concurrentReleases += 1;
    }

    const basicQuery = knex('polite_queue')
      .groupBy('polite_queue.hostname')
      .limit(this.options.releasesPerBatch);

    return this._purgeUnthrottledHosts()
      .then(() => {
        // Reserve a host (Making a raw query as Knex otherwise for some reason won't return the hostname)
        return this.stopped ? false : knex.transaction(trx => {
          // We need to ensure that no one else reserves the same thing
          return this.stopped ? false : trx.raw('LOCK TABLE polite_hosts')
            .then(() => {
              return this.stopped ? false : trx.raw(knex('polite_hosts')
                .returning('polite_hosts.hostname')
                .insert(
                  basicQuery
                    .clone()
                    .select(
                      'polite_queue.hostname',
                      knex.raw('CURRENT_TIMESTAMP AS added')
                    )
                    .leftJoin('polite_hosts', 'polite_queue.hostname', 'polite_hosts.hostname')
                    .whereNull('polite_hosts.hostname')
                    .orderByRaw('MIN(polite_queue.added) ASC')
                ).toString());
            });
        });
      })
      .catch(err => {
        this.concurrentReleases -= 1;
        throw new VError(err, 'Failed reserve slots for queued URL:s');
      })
      .then(result => {
        if (this.stopped || result.rowCount === 0) {
          this.concurrentReleases -= 1;
          return 0;
        }

        const hostnames = result.rows.map(row => row.hostname);

        const groupQuery = basicQuery.select('hostname', knex.raw('MIN(polite_queue.added) AS added'))
          .whereIn('hostname', hostnames)
          .orderBy('added', 'asc');

        // Fetch the first URL that was queued for the host
        knex.raw(
          'SELECT DISTINCT ON (polite_queue.hostname) id, url, messages FROM polite_queue ' +
          'INNER JOIN (' + groupQuery.toString() + ') AS grouped ' +
          'ON grouped.hostname = polite_queue.hostname AND grouped.added = polite_queue.added'
        )
          .then(result => {
            if (!result) {
              return Promise.reject(new VError('Couldn\'t find URL'));
            } else if (this.stopped) {
              return [];
            }

            const ids = result.rows.map(row => row.id);

            // Delete the URL from the queue
            return knex('polite_queue')
              .delete()
              .whereIn('id', ids)
              .then(() => result.rows);
          })
          .then(rows => {
            // Invoke all of the callbacks
            rows.forEach(row => {
              let messages = row.messages || [];

              messages = messages.length ? messages : [null];

              messages.forEach(message => {
                setImmediate(() => {
                  this.releaseCallback(null, row.url, message);
                });
              });
            });
          })
          .catch(err => {
            this.log('An error occured while releasing URL for hostnames, ', hostnames, '–', err.message);
          })
          .then(() => {
            this.concurrentReleases -= 1;
            this._watchForReleasables();
          });

        return result.rowCount;
      });
  }

  _watchForReleasables () {
    if (this.stopped) {
      this.logger.debug('Not going to watch due to stopping');
      return;
    }

    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = undefined;
    }

    this._checkForReleasables()
      .catch(err => {
        this.log('Error when watching for released URL:s:', err.message, err.stack);
        return false;
      })
      .then(foundUrls => {
        if (foundUrls >= this.options.releasesPerBatch) {
          if (this.concurrentReleases < this.options.concurrentReleases) {
            this.logger.debug('Found', foundUrls, 'URL:s. Adding new release check:', this.concurrentReleases + 1);
            this._watchForReleasables();
          } else {
            this.logger.debug('Reached max concurrent releases of', this.options.concurrentReleases);

            if (this.releaseTimer) {
              clearTimeout(this.releaseTimer);
              this.releaseTimer = undefined;
            }
          }
        } else if (!this.releaseTimer) {
          const delay = Math.round(this.options.throttleDuration / 2 * Math.random());
          this.logger.debug('Retrying in', delay, 'ms');
          this.releaseTimer = setTimeout(() => { this._watchForReleasables(); }, delay);
        }
      });
  }

  _reserveSlot (hostname) {
    const knex = this.knex;

    return knex('polite_hosts')
      .insert(
        knexQueryBuilder(knex)
          .select(
            knex.raw('? AS hostname', hostname),
            knex.raw('CURRENT_TIMESTAMP AS added')
          )
          .whereNotExists(
            knex('polite_hosts').select('*').where('hostname', hostname)
          )
      )
      .then(result => result.rowCount !== 0) // Did we manage to reserve it?
      .catch(err => {
        if (parseInt(err.code, 10) === 23505) {
          // Rejected as a duplicate, someone else managed to reserve it before us
          return false;
        }

        throw new VError(err, 'Failed to add row');
      });
  }

  _upsertUniqueUrlToQueue (url, message) {
    const knex = this.knex;

    let arrayConversion, arrayAppending;

    const update = {
      updated: knex.fn.now()
    };

    if (message && !this.onlyDeduplicateMessages) {
      arrayConversion = knexQueryBuilder(knex)
        .as('array_conversion')
        .select(knex.raw('json_array_elements(polite_queue.messages) AS messages'));

      arrayAppending = knexQueryBuilder(knex)
        .from(arrayConversion)
        .select(knex.raw('array_to_json(array_agg(array_conversion.messages) || ?::json)', [JSON.stringify(message)]));

      update.messages = arrayAppending;
    }

    let query = knex('polite_queue')
      .update(update)
      .where('url', url);

    if (this.onlyDeduplicateMessages) {
      query = message ? query.whereRaw('messages::TEXT = ?', [JSON.stringify([message])]) : query.whereNull('messages');
    } else {
      query = query.whereNotNull('noduplicate');
    }

    return query
      .then(affectedRows => affectedRows ? Promise.resolve() : this._addUrlToQueue(url, message, true))
      .catch(err => {
        if (parseInt(err.code, 10) === 23505) {
          // Rejected as a duplicate, someone else managed to add it before us – try again
          return this._upsertUniqueUrlToQueue(url, message);
        }

        throw new VError(err, 'Failed to upsert unique URL to queue');
      });
  }

  _addUrlToQueue (url, message, noduplicate) {
    const knex = this.knex;
    const hostname = (new URL(url)).hostname;

    return knex('polite_queue').insert({
      url,
      messages: message ? JSON.stringify([message]) : null,
      hostname,
      updated: knex.fn.now(),
      added: knex.fn.now(),
      noduplicate: noduplicate && !this.onlyDeduplicateMessages ? true : null
    })
      .catch(err => Promise.reject(new VError(err, 'Failed to add URL to queue')));
  }

  close () {
    this.stopped = true;

    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = undefined;
    }
  }

  releasedFromQueue (callback) {
    this.releaseCallback = callback;
    this._watchForReleasables();
  }

  queueForLater (url, message, options) {
    let result;

    options = Object.assign({
      allowDuplicates: undefined
    }, options || {});

    if (options.allowDuplicates !== false) {
      result = this._addUrlToQueue(url, message);
    } else {
      result = this._upsertUniqueUrlToQueue(url, message);
    }

    return result;
  }

  reserveSlot (url) {
    const { hostname } = new URL(url);

    return this
      ._purgeUnthrottledHosts()
      .then(() => this._reserveSlot(hostname))
      .catch(err => Promise.reject(new VError(err, 'Database error on reservation')));
  }
}

module.exports = PolitePGLookup;
