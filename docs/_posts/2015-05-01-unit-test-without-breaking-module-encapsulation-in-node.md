---
date: 2015-05-01T12:00:00-07:00
tag:
    - nodejs
    - testing
---

# Unit Test without Breaking Encapsulation in Node

## The inconvenience of encapsulation

When writing unit tests, the most ugly & painful & stupid thing you might have to do is to expose some internal implementation of your module to the testing code so that:

- It is easier to enumerate all possible conditional branches to cover some edge cases; (although if you have a complex design, you can always achieve this by mocking things, however sometimes it's an overkill)
- It is possible to inspect side effects of your code; (accept the dark side of the reality, you cannot totally avoid side effects)
- It is easier to replace some dependencies with mocks. (although if you have a good design, you should be able to inject all dependencies, but it's not a common thing in javascript realm)

Sometimes, you might even find yourself wasting a lot of precious time thinking about solutions to avoid writing such smelly code. But, hey! It's testing code! Shouldn't we have fun and enjoy writing it with all the power and flexibility we ought to have rather than struggling in these design holes? Why do we have to break core code for testing code?

Recently I found an excellent library [rewire](https://github.com/jhnns/rewire) that neatly solves this problem. Moreover, the idea behind it is really creative so that I'd like to share it in this post.

Nothing is more valuable than an example. Let's try to make a really simple one. The code logic might not be very reasonable, just made for showing the problems and how rewire can solve them. You can find the whole example [here](https://github.com/jiaz/rewire-example).

Given the following scenario: You are implementing a log appender, which writes aggregated log messages to some database in batch. And somehow the database has throttling control so that you cannot write to it more than once per second. Here is something you might write.

``` javascript
var db = require('./db');

var batchSize = 10;
var lastWriteTime = null;
var count = 0;
var data = "";

function flushToDB() {
    db.write(data);
    data = "";
    count = 0;
    lastWriteTime = Date.now();
}

exports.append = function(message) {
    data += message + "\n";
    count += 1;

    var duration = Date.now() - lastWriteTime;
    if (count >= batchSize && duration > 1000) {
        flushToDB();
    }
};
```

Now you might want to write some test cases to test your code. The three basic cases might be:

- The appender shouldn't flush until batch size is reached.
- The appender shouldn't flush twice within one second.
- The appender should flush when batch size is reached and more than 1 second is elapsed from last flush.

Here comes to the problems:

- How do I know the batch size? It's not exposed anywhere. And probably it's a private information that need to be hidden in the module.
- How do I know if the `flushToDB` method is called?
- How do I change to a mock db for unit test?
- How do I easily control the `duration` so that the `if` branch can be tested without using some fancy thing to mock the datetime or wasting your test time for setTimeout?

The fundamental challenge is that we have hidden states in the module which are not supposed to be exposed.

## Here comes the rewire

rewire is a replacement for `require` for testing purpose. When it requires the module it also magically modifies your source code so that variables hidden in the module can be accessed and modified. Here is how you can use rewire to solve the above problems without touching the core module.

``` js
var rewire = require('rewire');
var assert = require('assert');

describe("LogAppender", function() {
    var logappender = rewire('../lib/logappender');
    it('should not flush when append less than batchSize times', function() {
        var batchSize = logappender.__get__('batchSize');
        var flushCalled = false;
        logappender.__set__('flushToDB', function() {
            flushCalled = true;
        })
        for (var i = 0; i < batchSize - 1; i++) {
            logappender.append("hello");
        }
        assert.strictEqual(flushCalled, false);
    });

    it('should flush when append more than batchSize times', function() {
        var batchSize = logappender.__get__('batchSize');
        var flushCalled = false;
        logappender.__set__('flushToDB', function() {
            flushCalled = true;
        })
        for (var i = 0; i < batchSize + 1; i++) {
            logappender.append("hello");
        }
        assert.strictEqual(flushCalled, true);
    });

    it('should not flush when duration less than 1 second', function() {
        var batchSize = logappender.__get__('batchSize');
        var flushCalled = false;
        logappender.__set__('flushToDB', function() {
            flushCalled = true;
        })
        logappender.__set__('lastWriteTime', Date.now() - 500);
        for (var i = 0; i < batchSize + 1; i++) {
            logappender.append("hello");
        }
        assert.strictEqual(flushCalled, false);
    });
});
```

And yeah, it runs successfully!

``` bash
$ node_modules/mocha/bin/mocha


  LogAppender
    ✓ should not flush when append less than batchSize times
    ✓ should flush when append more than batchSize times
    ✓ should not flush when duration less than 1 second


  3 passing (5ms)
```

## The idea behind the scene

I'm extremely interested how it implements the `__set__` and `__get__` function. How can they bind to the hidden variables in your module? So I step into the source code. It turns out that `eval` and closure does the magic. Let's take a close look at how `__set__` is implemented. `__get__` is very similar.

**Key point 1:** It modifies your source code to adding `__set__` functions to your code before requiring your module.

This is important, in this way, the added function is in the same lexical scope of your module so that it can access the module's internal variables.

**Key point 2:** `__set__` uses `eval` function to execute the variable replacing code.

Variables in the scope of `__set__` function are closed in the closure created by `eval` statement, thus in the `eval` function you can not only access the hidden variables in your module (inherited from the `__set__`  closure), but also access the variables in the `__set__` function. In this way, you can build a general function that can replace any declared variables in the module's scope.

Literally it append the following function to your module's source code:

``` js
module.exports.__set__ = function(varName, varValue) {
    // here we can access the "varName" variable in the module and also the arguments of __set__ function.
    eval(varName + "= varValue");
}
```

This technique really opens my mind. It's so powerful and I believe it has a lot more practical applications. Hope you will also enjoy this library.
