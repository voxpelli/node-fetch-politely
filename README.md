# Fetch Politely

[![Build Status](https://travis-ci.org/voxpelli/node-fetch-politely.svg?branch=master)](https://travis-ci.org/voxpelli/node-fetch-politely)
[![dependencies Status](https://david-dm.org/voxpelli/node-fetch-politely/status.svg)](https://david-dm.org/voxpelli/node-fetch-politely)
[![Known Vulnerabilities](https://snyk.io/test/github/voxpelli/node-fetch-politely/badge.svg?targetFile=package.json)](https://snyk.io/test/github/voxpelli/node-fetch-politely?targetFile=package.json)
[![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-brightgreen.svg?style=flat)](https://github.com/Flet/semistandard)


A library for ensuring polite outgoing HTTP requests that respect robots.txt and aren't made too close to each other

## Installation

```bash
npm install fetch-politely --save
```

## Usage

Simple:

```javascript
const fetchInstance = new FetchPolitely((err, url, message) => {
  if (err) { return; }

  // The URL has been cleared for fetching – the hostname isn't throttled and robots.txt doesn't ban it
}, {
  // Robots.txt checking requires specification of a User Agent as Robots.txt can contain User Agent specific rules
  // See http://en.wikipedia.org/wiki/User_agent for more info in format
  userAgent: 'Your-Application-Name/your.app.version (http://example.com/optional/full/app/url)',
});

// When a slot has been reserved the callback sent in the constructor will be called
fetchInstance.requestSlot('http://foo.example.org/interesting/content/');
```

## FetchPolitely()

`var fetchInstance = new FetchPolitely(callback, [options]);`

### Parameters

* **callback** – `(err, url, message, [content]) => {};`, called for each succesful request slot

### Options

* **throttleDuration** – for how long in milliseconds to throttle requests to each `hostname`. Defaults to `10` seconds.
* **returnContent** – whether to fetch and return the content with the callback when a URL has received a request slot. Defaults to `false`.
* **logger** – a [Bunyan](https://github.com/trentm/node-bunyan) compatible logger library. Defaults to [bunyan-duckling](https://github.com/bloglovin/node-bunyan-duckling) which uses `console.log()`/`.error()`.
* **lookup** – an object or class that keeps track of throttled hosts and queued URL:s. Defaults to `PoliteLookup`.
* **lookupOptions** – an object that defines extra lookup options.
* **allowed** – a function that checks whether a URL is allowed to be fetched. Defaults to `PoliteRobot.allowed()`.
* **robotCache** – a cache method used by `PoliteRobot` to cache fetched `robots.txt`. Defaults to wrapped [lru-cache](https://www.npmjs.com/package/lru-cache).
* **robotCacheLimit** – a limit of the number of items to keep in the default lru-cache of `PoliteRobot`.
* **robotPool** – an HTTP agent to use for the request-library of `PoliteRobot`.
* **userAgent** – _required_ by `PoliteRobot` and `options.returnContent`. The [User Agent](http://en.wikipedia.org/wiki/User_agent) to use for HTTP requests.

### Methods

* **requestSlot** – tries to reserve a request slot for a URL. Returns a Promise that will be resolved or rejected when the request has been made.

### Static

* **FetchPolitely.PoliteError** – a very polite error object used for eg. informing about denied URL:s
* **FetchPolitely.PoliteLookup** – defines the interface for keeping track of throttled hosts and queued URL:s
* **FetchPolitely.PolitePGLookup** – alternative lookup that uses PostgreSQL as the backend
* **FetchPolitely.PoliteRobot** – checks whether URL:s are allowed to be fetched according to [Robots.txt](http://en.wikipedia.org/wiki/Robots_exclusion_standard).

## fetchInstance.requestSlot()

`fetchInstance.requestSlot(url, [message], [options]);`

### Parameters

* **url** – the URL to reserve a request slot for
* **message** – a JSON-encodeable optional message containing eg. instructions for the `FetchPolitely` callback.

### Options

* **allow** – if set to `true` the URL will always be allowd and not be sent to the `allowed` function.
* **allowDuplicates** – if set to `false` no more than one item of every `url` + `message` combination will be queued.

## PoliteLookup

The simplest of simple implementations for keeping track of throttled hosts and queued URL:s. Handles it all in-memory. Same interface can be used to build a database backend for this though.

## PolitePGLookup

A PostgreSQL + [Knex](http://knexjs.org/)-driven lookup that throttles hosts and queues URL using database tables.

Use by setting up the tables in `pglookup.sql` and include by setting the `FetchPolitely` options to:

```javascript
{
  lookup: FetchPolitely.PolitePGLookup,
  lookupOptions: {
    knex: knexInstance
  }
}
```

Pull Requests are welcome if someone wants to pull out the Knex-dependency. Most projects where this has been used with Postgres has been using Knex so it got used here as well.

### lookupOptions

* **knex** – *required* – the database connection to use, provided through a [Knex](http://knexjs.org/) object.
* **purgeWindow** – the minimum interval in milliseconds between two host purges. Defaults to `500` ms.
* **concurrentReleases** – how many parallell database lookups to perform to check for released URL:s. Defaults to `2`.
* **releasesPerBatch** – how many URL:s to fetch in each database lookup. Defaults to `5`.
* **onlyDeduplicateMessages** – bool that if set will only deduplicate URL:s with the same message when deduplicating. Defaults to `false`.

## Lint / Test

`npm test`
