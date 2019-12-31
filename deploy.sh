#!/bin/bash

set -e

yarn build

cd docs/.vuepress/dist

echo 'jiajizhou.com' > CNAME

git init
git add -A
git commit -m 'deploy'

git remote add origin https://github.com/jiaz/jiaz.github.io
git push -f origin master

cd -
