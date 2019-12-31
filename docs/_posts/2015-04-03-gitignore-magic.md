---
date: 2015-04-03T12:00:00-07:00
tag:
    - git
---

# gitignore Magic

.gitignore file looks simple. However, if I ask you the question:

> What’s the difference between `log/*` and `log/`?

I bet most people cannot tell correctly.

I came across this question when I did a .gitignore file clean-up in my project. It took me a while to understand the difference and I find it super easy to be forgotten. After looking up the manual and doing experiments several times, I decide to write this post. Hope it can help those who think about this question as well.

<!--more-->

You can find the documentation of .gitignore file [here](http://git-scm.com/docs/gitignore).

Most rules are quite clear, however it does not include enough examples, especially for patterns involving `/`, the rules of which are not intuitive.

Let me rephrase them here. There are 3 basic rules for the patterns involving `/`:

1. If the pattern ends with `/`, the trailing slash is first removed then continue to process next rules. The matching result will be restricted to directory only.
2. If there is __no `/` in the pattern__, it uses the pattern to match __all file or directory names regardless of the depth__. For example, `log` matches `log`, `log/` and `abc/log`. Another example with trailing slash, `log/` matches `log/`, `abc/log/` or `abc/efg/log/`.
3. If the __pattern contains `/`__, it uses the pattern to match the __full path relative to the .gitignore file__. That is, the full path will be considered rather than part of the filename. For example, `shared/log` will match `shared/log` or `shared/log/`, but not `abc/shared/log`

So based on these rules, there is a subtle difference between `log/` and `log/*`.

For `log/`, it will be processed according to Rule 1 and 2, which means it matches any directory named `log`. For example, it matches `log/`, `abc/log/` or `abc/efg/log/`, no matter how deep the directory is.

However for `log/*`, it will be processed according to Rule 3, which means it matches only files or directories under root `log/` directory. Here ‘root’ is the current .gitignore file path. For example, it matches `log/abc` or `log/efg/`, but not `abc/log` or `abc/log/`.

See, the handling of trailing slash is a little bit counterintuitive.
