# 真王核心 · 家园联网版

构建：20261012-paper-home-room-directory-v1；版本：V0.3.44。

直接导入“真王核心-纸剧场-V0.3.44-家园联网轻量版.json”，在酒馆助手中手动启用，并停用旧真王核心脚本；已有角色卡、世界书、对白正则、MVU 与酒馆助手继续沿用。导入通常新增关闭的脚本，不会自动替换旧脚本。

轻量脚本 9.31 MB；全部 324 张图片均保留，其中 6 张入口/加载纸卡继续内嵌，318 张原图片独立联网加载，合计 324.83 MB。原图片不重绘、不缩放、不压缩。音乐保留原有内嵌字节。
复用已发布固定资源目录中的 306 张原图，本版本仅新增 12 张图片。SHA256SUMS.txt 的 assets/ 项在本地构建目录可直接核对；线上地址以 asset-manifest.json 中每张图片的 primaryUrl 为准，publish 表明是否随本版本发布。

也可使用极小的网络入口：

```js
import 'https://kulsetiid.github.io/true-king-roster/paper-home-v3/20261012-paper-home-room-directory-v1/index.js';
```

网络入口需要先下载脚本；轻量导入 JSON 则可以直接启动本地内嵌的小帮手。打开页面后只加载该页面资源；角色仅加载本次使用的行为组三帧，成功图片在当前核心会话内保留复用，浏览器缓存也可继续复用。进度显示本次图片总数、成功数与失败数，下载/解码未完成不能算成功；失败时显示重试。第一次使用需要网络。当前没有额外 CDN 备源。

本版本独立发布到 https://kulsetiid.github.io/true-king-roster/paper-home-v3/20261012-paper-home-room-directory-v1/，不覆盖旧标准版根入口。图片清单和原字节 SHA-256 见 asset-manifest.json；发布文件校验见 SHA256SUMS.txt。
