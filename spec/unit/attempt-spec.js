/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var within = require('../within');

describe('attempt', function() {
  var timeoutDurations, theTime;
  var attempt;
  beforeEach(function() {
    theTime = 123456;
    timeoutDurations = [];
    var fakeSetTimeout = function(callback, duration) {
      timeoutDurations.push(duration);
      setImmediate(function() {
        theTime += duration;
        callback();
      });
    };
    attempt = require('../../lib/internal/attempt')
        .inject(fakeSetTimeout, function() {
          return theTime;
        })
        .attempt;
  });

  var doSomething, equalTo200;
  beforeEach(function() {
    doSomething = jasmine.createSpy('doSomething');
    equalTo200 = jasmine.createSpy('equalTo200')
        .and.callFake(function(result) {
          return result === 200;
        });
  });

  it('calls doSomething asynchronously', function() {
    attempt({'do': doSomething, until: equalTo200}, function() {});
    expect(doSomething).not.toHaveBeenCalled();
  });

  it('asynchronously calls the callback with an error', function(done) {
    doSomething.and.callFake(function(callback) {
      callback(new Error('uh-oh!'));
    });

    var called = false;

    attempt({'do': doSomething, until: equalTo200}, function(err, result) {
      called = true;
      expect(err).toMatch('uh-oh!');
      expect(result).toBe(null);
      expect(equalTo200).not.toHaveBeenCalled();
      done();
    });

    expect(called).toBe(false);
  });

  describe('(when the first attempt succeeds)', function() {

    beforeEach(function() {
      doSomething.and.callFake(function(callback) {
        callback(null, 200);
      });
    });

    it('asynchronously calls the callback with the successful result', function(done) {
      var called = false;

      attempt({'do': doSomething, until: equalTo200}, function(err, result) {
        called = true;
        expect(err).toBe(null);
        expect(result).toBe(200);
        done();
      });

      expect(called).toBe(false);
    });


    it('gives the result to the success tester', function(done) {
      attempt({'do': doSomething, until: equalTo200}, function() {
        expect(equalTo200).toHaveBeenCalledWith(200);
        done();
      });
    });
  });

  describe('(when the second attempt succeeds)', function() {
    beforeEach(function() {
      var attemptCount = 0
      doSomething.and.callFake(function(callback) {
        var result = (attemptCount++ === 0) ? 500 : 200;
        callback(null, result);
      });
    });

    it('calls doSomething twice', function(done) {
      attempt({'do': doSomething, until: equalTo200}, function(err, result) {
        expect(doSomething.calls.count()).toBe(2);
        done();
      });
    });

    it('calls equalTo200 with both results', function(done) {
      attempt({'do': doSomething, until: equalTo200}, function(err, result) {
        expect(equalTo200.calls.allArgs()).toEqual([[500], [200]]);
        done();
      });
    });

    it('calls the callback with the successful result', function(done) {
      attempt({'do': doSomething, until: equalTo200}, function(err, result) {
        expect(err).toBe(null);
        expect(result).toBe(200);
        done();
      });
    });

    it('waits approximately 500 ms', function(done) {
      attempt({'do': doSomething, until: equalTo200}, function(err, result) {
        expect(timeoutDurations).toEqual([within(250).of(500)]);
        done();
      });
    });
  });

  describe('(when multiple attempts fail)', function() {
    beforeEach(function() {
      doSomething.and.callFake(function(callback) {
        callback(null, 500);
      });
    });

    it('does exponential backoff', function(done) {
      var TIMEOUT = 5000;
      var INTERVAL = 700;
      var INCREMENT = 1.2;
      var JITTER = 0.2;

      var startTime = theTime;

      attempt({
        'do': doSomething,
        until: equalTo200,
        timeout: TIMEOUT,
        interval: INTERVAL,
        increment: INCREMENT,
        jitter: JITTER
      }, function(err, result) {
        expect(result).toBe(null);
        expect(err).toMatch('timeout');

        var waitTime = INTERVAL;
        timeoutDurations.forEach(function(duration, i) {
          expect(duration).toEqual(within(waitTime * JITTER).of(waitTime));
          waitTime *= INCREMENT;
        });
        expect(theTime).toBeLessThan(startTime + TIMEOUT);
        expect(theTime + (1 + JITTER) * waitTime)
            .toBeGreaterThan(startTime + TIMEOUT);

        done();
      });
    });

    it('can be cancelled immediately', function(done) {
      attempt({'do': doSomething, until: equalTo200}, function(err, result) {
        expect(result).toBe(null);
        expect(err).toMatch('cancelled');
        done();
      }).cancel();
    });

    it('can be cancelled while running', function(done) {
      var wasCancelled = false;
      // A fake action, which never completes, but can be cancelled.
      var doNothing = jasmine.createSpy('doNothing')
          .and.callFake(function(callback) {
            return {
              cancel: function() {
                wasCancelled = true;
                process.nextTick(function() {
                  return callback(new Error('cancelled'), null);
                });
              }
            }
          });

      var handle = attempt({
        'do': doNothing,
        until: equalTo200
      }, function(err, result) {
        expect(wasCancelled).toBe(true);
        expect(err).toMatch(/cancelled/);
        done();
      });

      setTimeout(function() {
        expect(doNothing).toHaveBeenCalled();
        handle.cancel();
      }, 10);
    })
  });
});
