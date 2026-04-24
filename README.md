# Bilicast

把 B 站视频快速收进自己的播放列表，直接后台听。🎧

Bilicast 是一个 Chrome Manifest V3 扩展，面向把 B 站当作音乐、播客、直播回放、课程音频来源来使用的人。打开视频页，一键加入列表，切回工作流，播放继续。

## Why Bilicast

- 🎵 视频页直接加入播放列表
- ▶️ 后台持续播放，不绑当前标签页
- 🔁 支持单曲循环、列表循环、全部循环、随机播放
- ⏩ 支持上一首、下一首、进度拖动、独立音量
- 🗂️ 支持多分类管理
- 🧩 按 `BV + P` 记录视频，多 P 内容可分别加入
- 🔄 音频链接失效后可自动重新获取并续播

## Preview

适合这些场景：

- 听歌、听 Live、听演唱会回放
- 听播客、访谈、知识区长视频
- 一边工作一边把 B 站当音频源挂着

## Features

- 视频页一键添加当前内容
- 自定义分类创建与删除
- 后台音频播放
- 播放 / 暂停 / 上一首 / 下一首
- 单曲循环 / 列表循环 / 全部循环 / 随机播放
- 进度调整与音量控制
- 当前播放高亮
- Popup 分类列表拖拽排序
- 单击列表项直接打开原始视频页
- 批量删除列表项
- 导入 / 导出播放列表
- 音频地址自动解析与失效重取

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
- 整页合集批量加入
- 更稳的音频容错与质量选择

## License

GPL-2.0-only
