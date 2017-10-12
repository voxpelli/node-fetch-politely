'use strict';

var util = require('util');

var PoliteError = function PoliteError (message, cause) {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);

  this.name = this.constructor.name;
  this.message = message;

  if (cause) {
    this.cause = cause;
  }
};
util.inherits(PoliteError, Error);

module.exports = PoliteError;
