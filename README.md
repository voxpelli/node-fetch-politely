# Fetch Politely

A library for ensuring polite outgoing HTTP requests that respect robots.txt and aren't made too close to each other

## Installation

```bash
npm install fetch-politely --save
```

## Usage

Simple:

```javascript
var fetchInstance = new FetchPolitely(function (err, url, message) {
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

* **callback** – `function (err, url, message, [content]) {};`, called for each succesful request slot

### Options

* **throttleDuration** – for how long in milliseconds to throttle requests to each `hostname`. Defaults to `10` seconds.
* **returnContent** – whether to fetch and return the content with the callback when a URL has received a request slot. Defaults to `false`.
* **log** – a logger function. Defaults to `console.log()`.
* **debug** – a debug-level logger function. Defaults to `function () {}`.
* **lookup** – an object or class that keeps track of throttled hosts and queued URL:s. Defaults to `PoliteLookup`.
* **lookupOptions** – an object that defines extra lookup options.
* **allowed** – a function that checks whether a URL is allowed to be fetched. Defaults to `PoliteRobot.allowed()`.
* **robotCache** – a cache method used by `PoliteRobot` to cache fetched `robots.txt`. Defaults to wrapped [lru-cache](https://www.npmjs.com/package/lru-cache).
* **userAgent** – _required_ by `PoliteRobot` and `options.returnContent`. The [User Agent](http://en.wikipedia.org/wiki/User_agent) to use for HTTP requests.

### Methods

* **requestSlot** – tries to reserve a request slot for a URL.

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

* **knex** – **required** – the database connection to use, provided through a [Knex](http://knexjs.org/) object.
* **purgeWindow** – the minimum interval in milliseconds between two host purges. Defaults to `500` ms.
* **concurrentReleases** – how many parallell database lookups to perform to check for released URL:s. Defaults to `2`.
* **releasesPerBatch** – how many URL:s to fetch in each database lookup. Defaults to `5`.

## Lint / Test

`npm test` or to watch, install `grunt-cli` then do `grunt watch`
