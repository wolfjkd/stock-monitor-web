# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [3.0.0] - 2026-06-08

### Added
- Web版 v3.0 初始实现，基于Flask + Bootstrap图形界面
- 多TDX节点支持，自动选择最优低延迟节点
- 表格新增"委托方向"列，区分买入/卖出方向
- 预警触发时表格行和行情卡片闪烁提醒
- 不同股票用不同背景色+分隔线区分
- 版本号管理，新增 /api/version API
- 前端显示版本号徽章
- 基于CLI版核心代码重构为Web版

### Changed
- 重新设计页面布局，适配1920x1080单屏显示
- "方向"改名"监控方向"，列间加分隔线
- 调整表格列顺序，优化信息展示
- 更新TDX节点为优选低延迟节点（郑州 182.118.8.4:7709）

### Fixed
- 临界预警阈值改为0.01元（绝对值），更精准
