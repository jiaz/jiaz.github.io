---
date: 2015-05-17T12:00:00-07:00
tag:
    - go
    - testing
---

# A Simple HTTP Load Testing Client in Go

## The Problem

Last week we try to reproduce an incident in our production system which is caused by an eleviation of HTTPS connection creation rate. The service was flooded by more than 2000 concurrent connections per server at peak. We then tried to use apache benchmark (ab) to reproduce the issue in a local environment. However we found that although ab allows you to specify a concurrency level by using `-c` flag, it actually cannot reach that amount of concurrency because ab will hit the server's QPS bottleneck first and stop generating more concurrent connections.

What we want is a load testing client that can serve limited QPS at high concurrent level.

I know there are [several](https://github.com/tsenart/vegeta) [existing](https://www.joedog.org/siege-home/) [tools](https://github.com/tarekziade/boom) that can tweak QPS/delay and concurrency, but I had some bad experience on these tools before, either for performance or stability season and I don't want to waste time to learn and try them one by one, which probably would take me 2-3 hours to find a suitable one. Since the requirement is really simple, I decided to work on my own solution.

## The Solution

I've never written such a tool before so I basically have no preference on which platform I use to implement it. I think Go should be good at modeling concurrency so I decided to give it a try.

I found goroutine a very natural way for modeling concurrent connections. So here is how to generate concurrent connections. (Please note that the code is not runnable since I picked them from the whole program. I'll provide a link to the full source code in the end of this post.)

``` go
for i := 0; i < *concurrency; i++ {
    go func() {
        client := &http.Client{}
        for {
            sendRequest(client, *req, *concurrency)
        }
    }()
}	
``` 

Here `concurrency` and `req` are input parameters to the program given by command line.

However these goroutines will generate requests as quick as possible so we need a way to limit the QPS. I used a buffered channel as a blocking queue to generate tokens for sending requests, then all client goroutines are required to get the token first then sending the request. Also setup a separate goroutine to constantly fill in the token queue to allow more requests to be generated. Here is the code:

``` go
bucket := make(chan bool, *maxQPS)

go func() {
    for {
        for i := 0; i < *maxQPS; i++ {
            select {
            case bucket <- true:
            default:
            }
        }
        time.Sleep(time.Second)
    }
}()	

for i := 0; i < *concurrency; i++ {
    go func() {
        client := &http.Client{}
        for {
            <- bucket
            sendRequest(client, *req, *concurrency)
        }
    }()
}
``` 

Here I used the `select..default` construct to cancel adding tokens to the queue if the queue is full to avoid token generator  generating more tokens than wanted under race condition.

That's it! The basic functionality is done!

### Workaround `TIME_WAIT` connection problem

Because we want to test the scenario that clients keep generating new connections to the server, we specifically disabled keep-alive for the underlying connection. After running the program for a while we found that the client used up the IP port range reserved for client connection which is roughly 28k ports. The result is that on the client host, you observe a lot of TCP connections in `TIME_WAIT` state. This is an expected behavior of TCP connections. I did the following trick to workaround the problem:

- **Tweak the OS configuration on the running host.** We run the client on a Linux server, you can follow [this article](http://vincent.bernat.im/en/blog/2014-tcp-time-wait-state-linux.html) to set `net.ipv4.tcp_tw_reuse` to `1`.
- **Change the Dial of http.Transport to use `TCPConn.SetLinger(0)`.** Tweaking the network configuration is not enough, we also have to change the client's TCP connection to set `SO_LINGER` to `0` when create connections. See [this article](http://stackoverflow.com/questions/3757289/tcp-option-so-linger-zero-when-its-required) for detailed explanation.

After all these tweak, the performance of the final tool is really good, I can generate 200 concurrent connection with 400 max QPS using a single 2.4G Hz Xeon core.

Another beautiful feature of Go is that you can develop in your Mac OS and directly cross compile a Linux working binary on your Dev machine and deploy-by-copying-a-single-file. Sweet!

You can checkout the full working source code here: [https://github.com/jiaz/simpleloadclient](https://github.com/jiaz/simpleloadclient).

## Conclusion

Go is really good at modeling concurrencies. I can't imagine how many code I need to write to implement this tool in other language. In fact, I don't like Go for its lack of Generics and duck typing only type system. There are [a lot of](http://www.quora.com/What-reasons-are-there-to-not-use-Go-programming-language) [criticism of Go](http://www.quora.com/Do-you-feel-that-golang-is-ugly) and some of which are quite reasonable. However, despite the fact that it is not perfect, it is really sharp for the concurrency modeling. As a developer, we should open our mind by learning these different views to the world so that we can model our problems better with more suitable tools.

TCP connection tweaking is interesting. I've seen the `TIME_WAIT` problem a lot before in production service development. You need to understand TCP states pretty well to implement a decent performing service.
