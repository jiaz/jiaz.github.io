---
date: 2015-02-23T12:00:00-08:00
tag:
    - nodejs
---

# Why my node program won't exit?!

上周碰到一个很有意思的问题，同事找我来跑一个node的程序，结果跑完了最后一个step，但是程序没有退出。

这对刚从同步编程世界转过来的同学来说简直是不可思议的事情。刚开始我也以为是程序的bug，如果不是bug的话有可能是在等待某个callback，但一直没有触发，同事也不明白是为什么，正好我刚入职就让我investigate一下。之前虽然写过一些node的程序，但是都是小打小弄，所以刚开始没什么头绪。

因为node没有什么特别好的debug工具（至少我不熟悉），黔驴技穷使出老办法，comment代码看效果。这个程序的特点是，程序本身比较简单，但是引用了一大堆的模块，所以我先确定程序本身不是造成hang住的原因，办法很简单，把有用的逻辑全部注释掉，结果发现程序什么都不干也会hang住。所以问题就在那些require的模块上了。接下来就是二分查找注释一部分模块看效果，然后递归查找，最后定位在两个模块上。发现这两个模块都调用了setInterval这个函数，恍然大悟原来timer会block main函数的退出。

那么作为一个码农，光知道表面原因是不够的，所以跟着就产生了三个问题:

1. 为什么timer能block程序的退出？
2. 除了timer，还有没有其他东西会block？比如我之前说到的callback（这个我是知道的，因为之前碰到过没有callback程序不退出的情况）。
3. 如何方便地检测到block程序退出的原因？下次碰到同样的问题我可不想再二分查找了。

<!--more-->

平时活比较多，趁周末有时间就研究了一下。

要知道为什么程序被block了，那首先得知道你的程序在干什么。这就牵涉到了nodejs的程序的生命周期，程序是如何bootstrap的，js模块是如何被加载的，eventloop是如何实现的。很遗憾nodejs的debugger只能看到js的space，不知道程序底层究竟在做啥，而且网上相关的资料少之又少，所以只好把代码下载下来自己看。好在node的代码量不是非常多，写的也还算整洁，所以花了点时间还是能大致看懂的。为了方便以后有同样需求的同学，总结一下node bootstrap的过程，以及eventloop的处理。

下面我大概节选一些代码做一些注解，方便起见我过滤掉了windows相关的代码。当然我也没有完全看懂，因为c++程序的特点是短时间内不太可能看懂...但是大致的逻辑应该是明确的。

整个node程序的入口是node_main.cc:

``` cpp
# 以下代码节选自0.10.36.release版本
// UNIX
int main(int argc, char *argv[]) {
  return node::Start(argc, argv);
}
```

可以看到入口很简单，调用了`node::Start`这个函数进行处理。`node::Start`这个函数定义在node.cc中。

``` cpp
int Start(int argc, char *argv[]) {
  // 略去了一些不重要的...

  // 初始化信号处理，libuv
  // This needs to run *before* V8::Initialize()
  // Use copy here as to not modify the original argv:
  Init(argc, argv_copy);

  // 初始化v8引擎
  V8::Initialize();

  {
    Locker locker;
    HandleScope handle_scope;

    // Create the one and only Context.
    Persistent<Context> context = Context::New();
    Context::Scope context_scope(context);

    // 1. 初始化process这个对象，这个很重要，建议把代码下载下来看一下，
    // 里面可以发现一些没有document的方法哦
    // Use original argv, as we're just copying values out of it.
    Handle<Object> process_l = SetupProcessObject(argc, argv);
    v8_typed_array::AttachBindings(context->Global());

    // 2. Load方法会载入node.js这个模块，该模块返回一个方法，这个方法会根据命令行提供的参数
    // 载入所有的js模块，很重要
    // Create all the objects, load modules, do everything.
    // so your next reading stop should be node::Load()!
    Load(process_l);

    // 3. 进入runloop，也就是eventloop。这个eventloop是libuv实现的，是node的核心机制
    // uv_run内部是一个while循环，直到没有消息处理才会退出。
    // All our arguments are loaded. We've evaluated all of the scripts. We
    // might even have created TCP servers. Now we enter the main eventloop. If
    // there are no watchers on the loop (except for the ones that were
    // uv_unref'd) then this function exits. As long as there are active
    // watchers, it blocks.
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);

    EmitExit(process_l);
    RunAtExit();

  }

  return 0;
}
```

OK，上面这段很短的代码就非常重要了，它里面有整个node的核心运作机制，包括v8引擎的初始化，libuv eventloop的初始化，js模块的载入，以及eventloop的处理逻辑。Load函数会载入node.js这个模块，这个模块是存放在node_natives.h（build的时候会生成）中的一个string。其核心内容是`startup()`这个函数。因为太长了我就不贴了，里面最关键的是调用了`Module.runMain()`这个函数，定义在module.js中

``` js
// bootstrap main module.
Module.runMain = function() {
  // Load the main module--the command line argument.
  Module._load(process.argv[1], null, true);
  // Handle any nextTicks added in the first tick of the program
  process._tickCallback();
};
```

可以看到，它会把传入的第一个参数，作为模块去加载，这时候才真正hit到了你写的代码。

node会把js模块加载时同步运行的代码都执行完，直到hit到一个异步调用或者是全部运行完毕，这时候Load函数就会返回，然后就进入了`uv_run`这个函数。

`uv_run`是一个很短的函数，贴在下面。

``` cpp
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
  int timeout;
  int r;

  r = uv__loop_alive(loop);
  while (r != 0 && loop->stop_flag == 0) {
    UV_TICK_START(loop, mode);

    uv__update_time(loop);
    uv__run_timers(loop);
    uv__run_idle(loop);
    uv__run_prepare(loop);
    uv__run_pending(loop);

    timeout = 0;
    if ((mode & UV_RUN_NOWAIT) == 0)
      timeout = uv_backend_timeout(loop);

    uv__io_poll(loop, timeout);
    uv__run_check(loop);
    uv__run_closing_handles(loop);
    r = uv__loop_alive(loop);

    UV_TICK_STOP(loop, mode);

    if (mode & (UV_RUN_ONCE | UV_RUN_NOWAIT))
      break;
  }

  /* The if statement lets gcc compile it to a conditional store. Avoids
   * dirtying a cache line.
   */
  if (loop->stop_flag != 0)
    loop->stop_flag = 0;

  return r;
}
```

可以看到逻辑很简单，首先调用`uv__loop_alive()`检查while是否需要继续（看来`uv__loop_alive`就是我们要找的东西了！）。然后在while loop中处理各种事件。（建议可以看一下`uv_backend_timeout`这个函数，这个函数根据timer来估计下一次poll的timeout时间，里面可以看到node的timer是怎么实现的）

所以程序不退出的原因就是`uv__loop_alive()`返回了`true`。看下这个函数

```cpp
static int uv__loop_alive(uv_loop_t* loop) {
  return uv__has_active_handles(loop) ||
         uv__has_active_reqs(loop) ||
         loop->closing_handles != NULL;
}
```

应该能看懂了，这个函数会检查active的handle或者request，在libuv中，handle是事件处理对象的统称，而request那就是事件啦。所以程序不退出就两个原因，有handler活跃或者是有request没处理完。

好了，这时候我们大致已经知道了问题1、2的答案，那么问题3怎么解决，以后怎么处理类似的问题，二分查找是在太痛苦了，最好是能有一个方法知道当前的active handler和request咯。好吧，经过一番查找，原来node已经提供了这两个方法了。。。但是竟然你妹的没有写到doc里。。。定义在node.cc中：

``` cpp

  // define various internal methods
  NODE_SET_METHOD(process, "_getActiveRequests", GetActiveRequests);
  NODE_SET_METHOD(process, "_getActiveHandles", GetActiveHandles);

```

我知道了这两个方法去Google了一下，发现才800个搜索结果。。。怪不得之前一直找不到类似的文章。

知道了大招当然要试一下，祭出node-debug神器，在command line里调用之前会hang住的程序，为了方便我把一些内容抹掉了。。请自行想像。

``` bash
$ node-debug xxx.js
```

程序hang住后，pause程序。

然后在console中调用`process._getActiveHandlers()`，voila! 然后调用stop, close, whatever方法，你的程序就正常退出啦！

![找到了！](/images/nodehang2.png)

好了，问题圆满解决，后来想想可能google得当能解决更快些，但是看了这些代码之后能对node有更多的了解，整个过程还是很有价值的。

最后是copyright部分，以上代码都是摘自nodejs源码，附上许可。

``` cpp
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
```
