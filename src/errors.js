/**
 * Exit codes. A proof result (0 or 1) is never mixed with an input error (2).
 */
export const EXIT = Object.freeze({ PASS: 0, FINDINGS: 1, INPUT: 2 });

/**
 * The invocation or an input file is unusable. The CLI reports the message and
 * exits 2; it is never counted as a proof finding.
 */
export class InputError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'InputError';
  }
}

/** An InputError caused by the command line itself; the CLI adds a usage hint. */
export class UsageError extends InputError {
  constructor(message, options) {
    super(message, options);
    this.name = 'UsageError';
  }
}
