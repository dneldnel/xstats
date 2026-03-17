# xstats

一个 Chrome Extension，用 X 官方 API 统计指定账号在最近 7 天或自定义时间范围内的发帖数量，并在弹窗中直接展示：

- 7 天 x 24 小时热力图
- 每日总发帖量柱状图
- 本地时间 / UTC 图表切换
- 上次查询参数和图表结果本地保存

## 安装

当前项目无需构建，直接作为已解压扩展加载：

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前项目目录

## 使用方法

1. 在 X Developer Portal 创建挂在 Project 下的 App，并获取 `Bearer Token`
2. 打开扩展弹窗，填写 Token 和目标账号用户名
3. 选择开始时间、结束时间，或直接使用最近 7 天/24 小时
4. 点击“获取统计”
5. 在弹窗内查看热力图和每日总量图
6. 如有需要，可切换图表时区为“本地时间”或 `UTC`

## 注意事项

- 表单中的开始时间和结束时间是本地时间
- 请求 X API 时会自动转换为 `UTC ISO 8601` 格式
- 最近 7 天使用 `GET /2/tweets/counts/recent`
- 超过最近 7 天的范围使用 `GET /2/tweets/counts/all`
- 如果要查询更早数据，当前 Bearer Token 对应套餐必须支持 Full Archive
- Token、查询参数和最近一次图表结果保存在 `chrome.storage.local`

## 文件

- `manifest.json`: 扩展配置
- `popup.html` / `popup.css` / `popup.js`: 主界面与统计逻辑
