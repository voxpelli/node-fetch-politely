## 0.5.0 (2015-04-08)


#### Features

* **lookup:** individual hostname throttle levels ([522f7a5a](http://github.com/voxpelli/node-fetch-politely/commit/522f7a5a14dde7f56841d280f9600cb6da45de3d))


## 0.4.0 (2015-04-07)


#### Bug Fixes

* **logging:**
  * improved flood check interval ([3f77945a](http://github.com/voxpelli/node-fetch-politely/commit/3f77945ad3ca0c6eeee62ee599807aa76645524d))
  * lower warning threshold ([72851872](http://github.com/voxpelli/node-fetch-politely/commit/7285187222812877954c4f24bddc2d31b56ddec8))
  * properly filter flooded hostnames ([6dded0e2](http://github.com/voxpelli/node-fetch-politely/commit/6dded0e2a181c4bebbb6bb16275873e8ae6ec58a))


#### Features

* **robot:** cache limit option ([daeb9033](http://github.com/voxpelli/node-fetch-politely/commit/daeb90333c7fb60d9340a8b2f18e3c3afa9ffa07))


### 0.3.1 (2015-04-01)


#### Bug Fixes

* **logging:** default to ”debug”-level logging ([060954c6](http://github.com/voxpelli/node-fetch-politely/commit/060954c6574a07fd41c0f0aff42ffdd8132a475c))


## 0.3.0 (2015-04-01)


#### Bug Fixes

* **dependencies:** updated Promise to 6.x.x ([1627d83a](http://github.com/voxpelli/node-fetch-politely/commit/1627d83a38f58edeae1ecec3cf9faa10452510bb))


#### Features

* **logging:**
  * warn on large throttle queues ([4ece841e](http://github.com/voxpelli/node-fetch-politely/commit/4ece841ed63f4a6aee09dfb58207c5b1f0fc713f))
  * moved to Bunyan-compatible logger ([28211718](http://github.com/voxpelli/node-fetch-politely/commit/2821171833fe8c2df1962a58fc95bb3a7ca17075))


#### Breaking Changes

* New option, ”logger”, for specifying which logger to use, the old ”log” option has been removed
 ([28211718](http://github.com/voxpelli/node-fetch-politely/commit/2821171833fe8c2df1962a58fc95bb3a7ca17075))


## 0.2.0 (2015-03-28)


#### Bug Fixes

* **logging:** removed an erroneous whitespace ([79bdcb64](http://github.com/voxpelli/node-fetch-politely/commit/79bdcb640cce7f3d6fc5eac1d7ff234b0595769d))
* **lookup:**
  * only serialise when needed ([1abdb8b9](http://github.com/voxpelli/node-fetch-politely/commit/1abdb8b9b0b4d42b63685af36a2b233fc09a666e))
  * ensure messages are serializable ([cfb91b4b](http://github.com/voxpelli/node-fetch-politely/commit/cfb91b4b35033c2b444f88697a589526fdcf6afe))
* **main:** return possible errors in slot-reserve ([05abc938](http://github.com/voxpelli/node-fetch-politely/commit/05abc93830fa0b74703077409392dc680874a7bd))


#### Features

* **lookup:** added a postgres driven lookup ([d68a2ad4](http://github.com/voxpelli/node-fetch-politely/commit/d68a2ad472255f3b4b50ddfdf5fa1ea6051ec76a))
* **main:**
  * can create instance of external lookup ([a025e514](http://github.com/voxpelli/node-fetch-politely/commit/a025e514e28cb5088871bc71717aea41b22c6b61))
  * added a debug options ([099ff456](http://github.com/voxpelli/node-fetch-politely/commit/099ff456fdeb44d807570f0cb43ab6a04cdb2b1b))
  * add a closing method ([6a34156a](http://github.com/voxpelli/node-fetch-politely/commit/6a34156a9254291dcf26ff6f332a7bbad4466deb))
  * option to disable allow-checks ([893ad429](http://github.com/voxpelli/node-fetch-politely/commit/893ad429eaf444510cc45e3e9e87d1e2e8c4ac9c))

