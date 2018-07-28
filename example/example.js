// @ts-check
/// <reference types="node" />

'use strict';

const start = Date.now();

const FetchPolitely = require('../');
const polite = new FetchPolitely((err, url, message, result) => {
  console.log('Callback', Math.round((Date.now() - start) / 1000), 'seconds after start:', err, url, message, result ? result.length : undefined);
  if (err) {
    console.log(err.stack);
  }
}, {
  throttleDuration: 5000,
  userAgent: 'Fetch-Politely/dev',
  returnContent: true,
  logger: require('bunyan-adaptor')(),
  lookupOptions: {
    throttleDurationHost: hostname => Promise.resolve(hostname === 'example.com' ? 500 : undefined)
  }
});

polite.requestSlot('http://example.com/');
polite.requestSlot('http://example.com/');
polite.requestSlot('http://example.com/');
polite.requestSlot('http://example.com/');
polite.requestSlot('http://example.com/');
polite.requestSlot('http://example.com/');
polite.requestSlot('http://example.com/');
polite.requestSlot('http://example.com/');

polite.requestSlot('http://voxpelli.com/');
polite.requestSlot(
  'http://voxpelli.com/',
  undefined,
  { allow: false }
);
polite.requestSlot(
  'http://voxpelli.com/',
  { purpose: 'extract-metadata' }, // Could be anything useful to process the fetched page
  { allowDuplicates: false }
);
polite.requestSlot(
  'http://voxpelli.com/',
  { purpose: 'extract-metadata' }, // Could be anything useful to process the fetched page
  { allowDuplicates: false }
);

// Unallowed fetch
polite.requestSlot('http://google.se/search/123');

// Trigger flood warnings
// for (var i = 0; i < 1000; i++) {
//   polite.requestSlot('http://example.com/' + i);
// }
