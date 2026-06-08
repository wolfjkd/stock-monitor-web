# stock-monitor-web 项目记忆

> 最后更新：2026-06-08

## 项目概述
A股价格预警监控系统Web版（v3.0），基于CLI版核心代码重构。

## 技术栈
- 后端：Flask 3.1.3
- 前端：Bootstrap 5 + JavaScript
- 数据源：eltdx通达信协议（TDX郑州节点 182.118.8.4:7709，~15ms延迟）
- 实时通信：SSE (Server-Sent Events)

## 核心文件
- `app.py` - Flask后端API（行情/配置/监控/SSE）
- `templates/index.html` - 前端页面
- `static/js/main.js` - 前端交互逻辑
- `scripts/price_alert.py` - CLI版核心代码（复用）
- `scripts/watchlist_config.json` - 监控配置

## 运行环境
- Python 3.13 + Flask + eltdx
- 启动：`python app.py` → http://localhost:5000

## 自选股（默认）
上海建工(600170)、和邦生物(603077)、中国能建(601868)、中国中铁(601390)、农产品(000061)、我爱我家(000560)

## GitHub
- 仓库：https://github.com/wolfjkd/stock-monitor-web
- 版本：v3.0
