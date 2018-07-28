// @ts-check
/// <reference types="node" />

'use strict';

class ExtendableError extends Error {
  /**
   * @param {string} message
   */
  constructor (message) {
    super(message);

    this.name = this.constructor.name;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
}

class PoliteError extends ExtendableError {
  /**
   * @param {string} message
   * @param {string} cause
   */
  constructor (message, cause) {
    super(message);

    if (cause) {
      this.cause = cause;
    }
  }
}

module.exports = PoliteError;
