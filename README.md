# CN Subtiers

中文 Minecraft 1.9+ PvP Subtier 榜单网站，支持：

- 读取仓库中的 `1.9+Subtier Overall(1).xlsx` 初始化榜单数据
- 前台展示榜单（搜索玩家、展示各模式 Subtier）
- 管理员后台（登录验证 + 新增/编辑/删除榜单）
- 安全能力（会话管理、CSRF 防护、登录限流、输入校验、安全响应头）

## 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

启动后访问：

- 前台：`http://localhost:3000/`
- 后台登录：`http://localhost:3000/admin/login`

## 默认管理员

如果没有配置环境变量，系统会自动创建默认管理员：

- 用户名：`admin`
- 密码：`ChangeMe_12345`

> 强烈建议在 `.env` 中修改为你自己的安全账号密码。

## 环境变量

参考 `.env.example`：

- `PORT`：端口
- `NODE_ENV`：运行环境（生产环境请使用 `production`）
- `SESSION_SECRET`：会话密钥（生产环境必须设置高强度随机值）
- `ADMIN_USERNAME`：管理员用户名
- `ADMIN_PASSWORD`：管理员密码（首次启动时用于初始化）
