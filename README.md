# Bilicast

把 B 站视频快速收进自己的播放列表，直接后台听。🎧

Bilicast 是一个 Chrome Manifest V3 扩展，面向把 B 站当作音乐、播客、直播回放、课程音频来源来使用的人。打开视频页，一键加入列表，切回工作流，播放继续。

## Why Bilicast

- 🎵 视频页直接加入播放列表
- ✅ 添加弹框可感知当前视频已收藏到哪些分类
- ▶️ 后台持续播放，不绑当前标签页
- 🔁 支持单曲循环、列表循环、全部循环、随机播放
- ⏩ 支持上一首、下一首、进度拖动、独立音量
- 🗂️ 支持多分类管理与轻量整理
- 🧩 按 `BV + P` 记录视频，多 P 内容可分别加入
- 🔄 音频链接失效后可自动重新获取并续播

## Preview

适合这些场景：

- 听歌、听 Live、听演唱会回放
- 听播客、访谈、知识区长视频
- 一边工作一边把 B 站当音频源挂着

## Features

- 视频页一键添加当前内容
- 视频页添加弹框显示“未收藏 / 已在这些分类”
- 已存在于当前分类时禁用添加，避免当前分类重复加入
- 分类管理弹窗内新建 / 重命名 / 删除分类
- 分类拖拽排序
- 单个视频移动到其他分类，并自动去重
- 后台音频播放
- 播放 / 暂停 / 上一首 / 下一首
- 单曲循环 / 列表循环 / 全部循环 / 随机播放
- 进度调整 / 音量控制 / 音质选择
- 当前播放高亮
- Popup 视频列表拖拽排序
- 视频条目左键单按钮播放，右键打开管理菜单
- 单击列表项直接打开原始视频页
- 批量删除列表项
- 导入 / 导出播放列表
- 音频地址自动解析与失效重取
- 点击视频播放，右键管理视频

## Category Management

当前分类整理集中放在 popup 的“分类管理”弹窗中：

- 在弹窗头部直接新建分类
- 普通分类可重命名、删除
- 默认分类“稍后播放”不可重命名、不可删除，但可以参与排序
- 分类支持拖拽排序，关闭 popup 后顺序仍会保留

视频整理保持轻量：

- 当前分类内支持拖拽调整视频顺序
- 单个视频可移动到其他分类
- 如果目标分类已存在同一 `BV + P`，移动后只保留一份

## Playlist Import / Export

播放列表支持导入和导出 JSON 文件，使用最小化、标准化结构，只保留恢复列表所需的必要字段，不导出音频地址、封面、时长、`cid` 等运行时数据。

标准结构：

```json
{
  "schema": "bilicast.playlist",
  "version": 1,
  "activeCategoryIndex": 0,
  "categories": [
    {
      "name": "稍后播放",
      "videos": [
        {
          "bvid": "BVxxxx",
          "page": 1,
          "title": "歌曲标题"
        }
      ]
    }
  ]
}
```

字段说明：

- `schema`: 固定为 `bilicast.playlist`
- `version`: 当前版本固定为 `1`
- `activeCategoryIndex`: 当前激活分类在 `categories` 中的下标
- `categories[].name`: 分类名称
- `categories[].videos[].bvid`: B 站视频 `BV` 号
- `categories[].videos[].page`: 多 P 页码，最小为 `1`
- `categories[].videos[].title`: 展示标题

导入行为：

- 导入会覆盖当前播放列表
- 当前播放会停止
- 播放模式和音量设置会保留
- 导入后视频页链接会根据 `bvid + page` 自动重建

## Install

### Build

```bash
pnpm install
pnpm build
```

构建产物会输出到 `dist/`。

### Load Extension

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择项目里的 `dist/` 目录

## Development

```bash
pnpm build
```


## Architecture

- `src/content`
  负责注入 B 站视频页，读取当前视频信息并提供添加入口
- `src/background`
  负责播放列表、播放状态、音频解析和消息路由
- `src/background/offscreen.*`
  负责真正的后台音频播放
- `src/popup`
  负责列表管理和播放器 UI
- `src/shared`
  放置状态结构和消息定义

项目当前使用了这些浏览器能力：

- `chrome.storage.local`
- `chrome.offscreen`
- `declarativeNetRequest`
- B 站公开接口与音频流地址解析

## Roadmap

- ✅ 拖拽排序
- ✅ 单击打开原始视频页
- ✅ 导入 / 导出播放列表
- ✅ 更稳的音频容错与质量选择
- ✅ 分类收藏感知
- ✅ 分类管理弹窗
- ✅ 单视频管理

## License

GPL-3.0-only
