---
date: 2015-07-03T12:00:00-07:00
tag:
    - nodejs
    - async
---

# "Thread-local" Context in Node

Recently, I'm doing some experiments to try to rewrite our Nodejs service in a more maintainable style. I'd like to write several posts to share my findings.

## Pain Points

We use `express.js` as the framework to build our Nodejs service. The service was started at about 2011, when Nodejs was still in its infant state. At that time there was no common paradigm to construct a fairly complex web service in javascript. When I joined the team, I found the performance of our service was not as good as I expected. I then started to investigate how to improve it. During my work I found several big pain points when trying to make breaking changes to the code base. The top 4 of them are:

- The magic `req`, `res` and `context` object. They are everywhere and you have to pass them everywhere, but you don't know exactly how they are used without reading every line of the project.
- Error handling is like crossing a big maze. You have to pass the error object from it's origin through probably 5-10 stacks to reach the handling logic.
- Heavily rely on callbacks, callback of callbacks, or even deeper callbacks to control the program's execution flow, which not only creates a callback hell but also creates extreme tight coupling of function calls.
- Difficult to test. Because we rely on closures, i.e. anonymous functions, to do async callbacks, we have a **lot** of anonymous functions that are not testable.

In Part 1, I'd like to talk about how to solve first pain point by using Nodejs' `Domain` module.

## Hello `Domain`, goodbye `req`

Because of Nodejs' async nature, you cannot store your current request's context in some centralized place and then using accessor methods to access the current working context, like thread-local contexts commonly used in Java web frameworks. Instead, you have to specifically pass these context objects into all the methods you called, so that these context can be captured in closures and being accessible when callback function is called.

If you keep writing code carefully, or you only have 1-2 contributors, it's probably not a big problem. However when the code is maintained by several guys, the code starts rotting. `req` will soon become a magic global garbage bin. You can "easily" put something into it in a function then accessing it from another to create a magic tight couple. You can "easily" access and modify the `req`'s parameters at anywhere as you wish. You can "easily" use `res.write` to send partial response in the middle of anywhere.

In the end you will have a code base that no one really knows exactly how the context is used and what is in it.

Kent Beck's [four simple design rules for clean code](https://theholyjava.wordpress.com/2011/02/14/clean-code-four-simple-design-rules/):

1. Runs all the tests
2. Contains no duplications
3. Expresses the intent of the programmers
4. Minimizes the number of classes and methods

Passing the `req` around violates rule \#2 and \#3 and makes your code hard to understand.

So how to solve the problem? By all means, we don't have thread local variables, which on the other hand is a good thing because we now have concurrency on a single thread.

There are 2 solutions:

1. Use `Domain`
2. Use [continuation-local-storage](https://github.com/othiym23/node-continuation-local-storage) module

If you are writing a library that might be included in other module then continuation-local-storage is recommended. If like me, you are implementing a web service, I would recommend you just use Domain. Domain is a native support in the Nodejs core while continuation-local-storage is a user land implementation. Another major difference is the error handling, which is out of the scope of this article.

## `Domain` in action

Domain was introduced in Nodejs v0.8, which mainly provides two things:

1. A sandbox for exception handling and isolation for an async process chain
2. An object that is bound to an async process chain

We will cover \#1 in a later post, now we focus on \#2.

When you run your code inside a domain, your code will have the access to the single domain object even in an async callback! It magically works for all Nodejs' native async functions, such as `net`, `fs`, timers, etc.

Let's see an example.

``` js
var domain = require('domain');

var d = domain.create();

d.run(function() {
    d.context = 'hello';

    setTimeout(function() {
        // process.domain returns the domain object
        // bound to the current async chain
        console.log(process.domain.context);
    }, 1000)
});
```

The above code will print out "hello" in the console. As you can see, the callback function doesn't require anything to access the current context even that it is in an async callback.

## Integrate with `express`

To integrate that into express framework, you can create a middleware to create a domain for each request and run the request handler in the domain thus provides you an "async local variable".

Here is a demo. In the demo, we use the context to keep track a requestId, an Id to uniquely identify a request, a common pattern used in web service implementation. Then the server did a simple async http get request.

``` js
var express = require('express');
var domain = require('domain');
var http = require('http');

var app = express();

var rid = 1;

// Centralized context object
function Context() {
    this.reqId = rid;
    rid += 1;
}
Context.getCurrent = function() {
    return process.domain.context;
}

app.use(function(req, res, next) {
    // create a domain for every request
    var d = domain.create();
    d.context = new Context();
    // req and res are created before the d domain is created,
    // so we have to add them to the domain manually.
    // newly created EventEmitter or other async constructs are
    // automatically added to the current domain.
    d.add(req);
    d.add(res);
    // run next in the created domain
    d.run(function() {
        next();
    })
});

app.get('/test', function(req, res) {
    http.get("http://www.google.com", function(resp) {
        var body = '';
        resp.on('data', function(data) {
            body += data.toString();
        });
        resp.on('end', function() {
            res.json({
                message: body.substring(0,100),
                reqId: Context.getCurrent().reqId
            });
        });
    });
});

app.listen(3000);
```

When the server starts. You can run test to see that it works.

``` bash

jiaji.zhou in ~/Workspace/playground/expressdemo [23:25:09]
$ curl http://localhost:3000/test
{
  "message": "<!doctype html><html itemscope=\"\" itemtype=\"http://schema.org/WebPage\" lang=\"en\"><head><meta content",
  "reqId": 1
}
jiaji.zhou in ~/Workspace/playground/expressdemo [23:25:26]
$ curl http://localhost:3000/test
{
  "message": "<!doctype html><html itemscope=\"\" itemtype=\"http://schema.org/WebPage\" lang=\"en\"><head><meta content",
  "reqId": 2
}
```

## Conclusion

With Domain, you can centralize your request states in an easily accessible context, which not only makes your code cleaner but also is extremely useful for writing functionalities such as transaction management.
