'use strict';

var VError = require('verror');

var assert = require('assert');
var urlModule = require('url');

var PolitePGLookup = function (options) {
  options = Object.assign({
    throttleDuration: 10 * 1000,
    concurrentReleases: 2,
    releasesPerBatch: 5,
    purgeWindow: 500
  }, options);

  assert(options.knex, 'PolitePGLookup requires the Knex option to work.');

  this.options = options;
  this.log = options.log;
  this.logger = options.logger;
  this.knex = options.knex;
  this.concurrentReleases = 0;
};

PolitePGLookup.prototype._purgeUnthrottledHosts = function () {
  if (this.closed || this.lastPurge && (Date.now() - this.lastPurge < this.options.purgeWindow)) {
    return Promise.resolve();
  }

  this.logger.debug('Purging expired hosts');
  var knex = this.knex;

  this.lastPurge = Date.now();

  return knex('polite_hosts')
    .where('added', '<', knex.raw('CURRENT_TIMESTAMP - interval \'' + Math.round(this.options.throttleDuration / 1000) + ' seconds\''))
    .delete();
};

PolitePGLookup.prototype._checkForReleasables = function (retry) {
  var knex = this.knex;
  var that = this;

  if (!retry) {
    this.concurrentReleases += 1;
  }

  var basicQuery = knex('polite_queue')
    .groupBy('polite_queue.hostname')
    .limit(this.options.releasesPerBatch);

  return this._purgeUnthrottledHosts()
    .then(function () {
      // Reserve a host (Making a raw query as Knex otherwise for some reason won't return the hostname)
      return that.stopped ? false : knex.transaction(function (trx) {
        // We need to ensure that no one else reserves the same thing
        return that.stopped ? false : trx.raw('LOCK TABLE polite_hosts')
          .then(function () {
            return that.stopped ? false : trx.raw(knex('polite_hosts')
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
    .catch(function (err) {
      that.concurrentReleases -= 1;
      throw new VError(err, 'Failed reserve slots for queued URL:s');
    })
    .then(function (result) {
      if (that.stopped || result.rowCount === 0) {
        that.concurrentReleases -= 1;
        return 0;
      }

      var hostnames = result.rows.map(function (row) {
        return row.hostname;
      });

      var groupQuery = basicQuery.select('hostname', knex.raw('MIN(polite_queue.added) AS added'))
        .whereIn('hostname', hostnames)
        .orderBy('added', 'asc');

      // Fetch the first URL that was queued for the host
      knex.raw(
        'SELECT DISTINCT ON (polite_queue.hostname) id, url, messages FROM polite_queue ' +
        'INNER JOIN (' + groupQuery.toString() + ') AS grouped ' +
        'ON grouped.hostname = polite_queue.hostname AND grouped.added = polite_queue.added'
      )
      .then(function (result) {
        if (!result) {
          return Promise.reject(new VError('Couldn\'t find URL'));
        } else if (that.stopped) {
          return [];
        }

        var ids = result.rows.map(function (row) {
          return row.id;
        });

          // Delete the URL from the queue
        return knex('polite_queue')
            .delete()
            .whereIn('id', ids)
            .then(function () {
              return result.rows;
            });
      })
        .then(function (rows) {
          // Invoke all of the callbacks
          rows.forEach(function (row) {
            var messages = row.messages || [];

            messages = messages.length ? messages : [null];

            messages.forEach(function (message) {
              setImmediate(function () {
                that.releaseCallback(null, row.url, message);
              });
            });
          });
        })
        .catch(function (err) {
          that.log('An error occured while releasing URL for hostnames, ', hostnames, '–', err.message);
        })
        .then(function () {
          that.concurrentReleases -= 1;
          that._watchForReleasables();
        });

      return result.rowCount;
    });
};

PolitePGLookup.prototype._watchForReleasables = function () {
  var that = this;

  if (this.stopped) {
    this.logger.debug('Not going to watch due to stopping');
    return;
  }

  if (this.releaseTimer) {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
  }

  this._checkForReleasables()
    .catch(function (err) {
      that.log('Error when watching for released URL:s:', err.message, err.stack);
      return false;
    })
    .then(function (foundUrls) {
      if (foundUrls >= that.options.releasesPerBatch) {
        if (that.concurrentReleases < that.options.concurrentReleases) {
          that.logger.debug('Found', foundUrls, 'URL:s. Adding new release check:', that.concurrentReleases + 1);
          that._watchForReleasables();
        } else {
          that.logger.debug('Reached max concurrent releases of', that.options.concurrentReleases);

          if (that.releaseTimer) {
            clearTimeout(that.releaseTimer);
            that.releaseTimer = undefined;
          }
        }
      } else if (!that.releaseTimer) {
        var delay = Math.round(that.options.throttleDuration / 2 * Math.random());
        that.logger.debug('Retrying in', delay, 'ms');
        that.releaseTimer = setTimeout(that._watchForReleasables.bind(that), delay);
      }
    });
};

PolitePGLookup.prototype._reserveSlot = function (hostname) {
  var knex = this.knex;

  return knex('polite_hosts')
    .insert(
      knex()
        .select(
          knex.raw('? AS hostname', hostname),
          knex.raw('CURRENT_TIMESTAMP AS added')
        )
        .whereNotExists(
          knex('polite_hosts').select('*').where('hostname', hostname)
        )
    )
    .then(function (result) {
      // Did we manage to reserve it?
      return result.rowCount !== 0;
    })
    .catch(function (err) {
      if (parseInt(err.code, 10) === 23505) {
        // Rejected as a duplicate, someone else managed to reserve it before us
        return false;
      }

      throw new VError(err, 'Failed to add row');
    });
};

PolitePGLookup.prototype._upsertUniqueUrlToQueue = function (url, message) {
  var knex = this.knex;

  var arrayConversion, arrayAppending;

  var update = {
    updated: knex.fn.now()
  };

  if (message) {
    arrayConversion = knex()
      .as('array_conversion')
      .select(knex.raw('json_array_elements(polite_queue.messages) AS messages'));

    arrayAppending = knex()
      .from(arrayConversion)
      .select(knex.raw('array_to_json(array_agg(array_conversion.messages) || ?::json)', [JSON.stringify(message)]));

    update.messages = arrayAppending;
  }

  return knex('polite_queue')
    .update(update)
    .where('url', url)
    .whereNotNull('noduplicate')
    .bind(this)
    .then(function (affectedRows) {
      return affectedRows ? Promise.resolve() : this._addUrlToQueue(url, message, true);
    })
    .catch(function (err) {
      if (parseInt(err.code, 10) === 23505) {
        // Rejected as a duplicate, someone else managed to add it before us – try again
        return this._upsertUniqueUrlToQueue(url, message);
      }

      throw new VError(err, 'Failed to upsert unique URL to queue');
    });
};

PolitePGLookup.prototype._addUrlToQueue = function (url, message, noduplicate) {
  var knex = this.knex;
  var hostname = urlModule.parse(url).hostname;

  return knex('polite_queue').insert({
    url: url,
    messages: message ? JSON.stringify([message]) : null,
    hostname: hostname,
    updated: knex.fn.now(),
    added: knex.fn.now(),
    noduplicate: noduplicate ? true : null
  }).catch(function (err) {
    throw new VError(err, 'Failed to add URL to queue');
  });
};

PolitePGLookup.prototype.close = function () {
  this.stopped = true;

  if (this.releaseTimer) {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
  }
};

PolitePGLookup.prototype.releasedFromQueue = function (callback) {
  this.releaseCallback = callback;
  this._watchForReleasables();
};

PolitePGLookup.prototype.queueForLater = function (url, message, options) {
  var result;

  options = Object.assign({
    allowDuplicates: undefined
  }, options || {});

  if (options.allowDuplicates !== false) {
    result = this._addUrlToQueue(url, message);
  } else {
    result = this._upsertUniqueUrlToQueue(url, message);
  }

  return result;
};

PolitePGLookup.prototype.reserveSlot = function (url) {
  var hostname = urlModule.parse(url).hostname;

  return this
    ._purgeUnthrottledHosts()
    .then(this._reserveSlot.bind(this, hostname))
    .catch(function (err) {
      throw new VError(err, 'Database error on reservation');
    });
};

module.exports = PolitePGLookup;
